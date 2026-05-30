import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { db, modbusReadingsTable } from "@workspace/db";
import {
  CreateModbusReadingBody,
  CreateModbusReadingResponse,
  ListModbusReadingsQueryParams,
  ListModbusReadingsResponse,
} from "@workspace/api-zod";
import { decodeModbusPayload } from "../modbus-decoder";
import {
  authenticateDeviceRequest,
  extractQueryToken,
  warnIfPreviousTokenSlot,
} from "../lib/device-auth";
import {
  resolveApiKeyToOrg,
  API_KEY_PREFIX,
} from "../lib/api-key-service";

const router: IRouter = Router();

const getSource = (req: Request) => {
  const forwardedFor = req.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || req.ip || null;
};

router.get("/modbus/readings", async (req, res): Promise<void> => {
  const queryInput: Record<string, unknown> = { ...req.query };
  if (typeof queryInput.since === "string" && queryInput.since.length > 0) {
    queryInput.since = new Date(queryInput.since);
  }
  if (typeof queryInput.until === "string" && queryInput.until.length > 0) {
    queryInput.until = new Date(queryInput.until);
  }

  const parsedQuery = ListModbusReadingsQueryParams.safeParse(queryInput);

  if (!parsedQuery.success) {
    req.log.warn(
      { errors: parsedQuery.error.message },
      "Invalid Modbus readings query",
    );
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  const filters: SQL[] = [];
  if (parsedQuery.data.deviceId) {
    filters.push(eq(modbusReadingsTable.deviceId, parsedQuery.data.deviceId));
  }
  if (parsedQuery.data.since) {
    filters.push(gte(modbusReadingsTable.receivedAt, parsedQuery.data.since));
  }
  if (parsedQuery.data.until) {
    filters.push(lte(modbusReadingsTable.receivedAt, parsedQuery.data.until));
  }
  if (parsedQuery.data.tokenSlot) {
    filters.push(eq(modbusReadingsTable.tokenSlot, parsedQuery.data.tokenSlot));
  }

  const readings = await db
    .select()
    .from(modbusReadingsTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(modbusReadingsTable.receivedAt))
    .limit(parsedQuery.data.limit);

  res.json(ListModbusReadingsResponse.parse({ readings }));
});

router.post("/modbus/readings", async (req, res): Promise<void> => {
  // Prefer per-org API keys; fall back to the legacy shared
  // MODBUS_INGEST_TOKEN(s) for in-flight devices.
  const provided =
    req.get("x-device-key")?.trim() ||
    (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() ||
    extractQueryToken(req.query) ||
    "";

  let resolvedOrgId: number | null = null;
  let resolvedKeyId: number | null = null;
  let authResult = authenticateDeviceRequest(req);

  if (provided.startsWith(API_KEY_PREFIX)) {
    const resolved = await resolveApiKeyToOrg(provided);
    if (resolved) {
      resolvedOrgId = resolved.orgId;
      resolvedKeyId = resolved.keyId;
      authResult = { ok: true, slot: "current", orgId: resolved.orgId, apiKeyId: resolved.keyId };
    } else {
      authResult = {
        ok: false,
        status: 401,
        error: "Unauthorized: API key invalid or revoked.",
      };
    }
  }

  if (!authResult.ok) {
    req.log.warn(
      { status: authResult.status, source: getSource(req) },
      "Rejected unauthorized Modbus reading request",
    );
    res.status(authResult.status).json({ error: authResult.error });
    return;
  }

  warnIfPreviousTokenSlot(req.log, authResult, { source: getSource(req) });
  // Make resolvedOrgId/resolvedKeyId visible to the rest of the handler
  // by stashing them on the request so the existing insert path can pick
  // them up without restructuring this large handler.
  (req as unknown as { _ingestOrgId?: number | null })._ingestOrgId = resolvedOrgId;
  void resolvedKeyId;

  const rawPayload = req.body;

  if (
    rawPayload == null ||
    typeof rawPayload !== "object" ||
    Array.isArray(rawPayload) ||
    Object.keys(rawPayload).length === 0
  ) {
    req.log.warn("Rejected empty or non-object Modbus reading payload");
    res.status(400).json({
      error: "Request body must be a non-empty JSON object.",
    });
    return;
  }

  const parsedBody = CreateModbusReadingBody.safeParse(rawPayload);

  if (!parsedBody.success) {
    req.log.warn(
      { errors: parsedBody.error.message },
      "Invalid Modbus reading payload",
    );
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }

  // The TRB246 streams one register per POST as {"ssss":[{"data":"..."}]}.
  // A single fragment can't be decoded on its own (the register address is
  // implied by poll order), so route these raw fragments to a dedicated
  // "trb246-raw" device. The backfill script consolidates them into decoded
  // snapshots under "trb246" so the main dashboard stays clean.
  const isRawFragment =
    "ssss" in rawPayload &&
    !("registers" in rawPayload) &&
    !("values" in rawPayload);

  const deviceId =
    parsedBody.data.deviceId?.trim() ||
    (typeof rawPayload["device"] === "string" && rawPayload["device"].trim()) ||
    (typeof rawPayload["imei"] === "string" && rawPayload["imei"].trim()) ||
    (isRawFragment ? "trb246-raw" : "trb246");
  const decodedValues = decodeModbusPayload(rawPayload);

  const ingestOrgId =
    (req as unknown as { _ingestOrgId?: number | null })._ingestOrgId ?? null;
  const [reading] = await db
    .insert(modbusReadingsTable)
    .values({
      orgId: ingestOrgId,
      deviceId,
      source: getSource(req),
      parsingStatus: "accepted",
      tokenSlot: authResult.slot,
      rawPayload,
      decodedValues,
    })
    .returning();

  res.json(CreateModbusReadingResponse.parse({
    accepted: true,
    reading,
  }));
});

export default router;
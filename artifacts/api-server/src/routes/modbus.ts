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
import { authenticateDeviceRequest } from "../lib/device-auth";

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
  const authResult = authenticateDeviceRequest(req);

  if (!authResult.ok) {
    req.log.warn(
      { status: authResult.status, source: getSource(req) },
      "Rejected unauthorized Modbus reading request",
    );
    res.status(authResult.status).json({ error: authResult.error });
    return;
  }

  if (authResult.slot === "previous") {
    req.log.warn(
      { source: getSource(req) },
      "Modbus reading authenticated with a previous (rotating) device token. Migrate this device to the current MODBUS_INGEST_TOKEN and retire the previous one.",
    );
  }

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

  const deviceId =
    parsedBody.data.deviceId?.trim() ||
    (typeof rawPayload["device"] === "string" && rawPayload["device"].trim()) ||
    (typeof rawPayload["imei"] === "string" && rawPayload["imei"].trim()) ||
    "trb246";
  const decodedValues = decodeModbusPayload(rawPayload);

  const [reading] = await db
    .insert(modbusReadingsTable)
    .values({
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
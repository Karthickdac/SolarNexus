import { timingSafeEqual } from "node:crypto";
import { desc } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { db, modbusReadingsTable } from "@workspace/db";
import {
  CreateModbusReadingBody,
  CreateModbusReadingResponse,
  ListModbusReadingsQueryParams,
  ListModbusReadingsResponse,
} from "@workspace/api-zod";
import { decodeModbusPayload } from "../modbus-decoder";

const router: IRouter = Router();
const DEVICE_TOKEN_ENV = "MODBUS_INGEST_TOKEN";
const DEVICE_TOKEN_PREVIOUS_ENV = "MODBUS_INGEST_TOKEN_PREVIOUS";

const getSource = (req: Request) => {
  const forwardedFor = req.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || req.ip || null;
};

const extractBearerToken = (authorization: string | undefined) => {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
};

const tokensMatch = (candidate: string, expected: string) => {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
};

const parseTokenList = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
};

type TokenSlot = "current" | "previous";

const getAcceptedTokens = (): { slot: TokenSlot; token: string }[] => {
  const current = process.env[DEVICE_TOKEN_ENV]?.trim();
  const previous = parseTokenList(process.env[DEVICE_TOKEN_PREVIOUS_ENV]);

  const tokens: { slot: TokenSlot; token: string }[] = [];
  const seen = new Set<string>();

  if (current) {
    tokens.push({ slot: "current", token: current });
    seen.add(current);
  }

  for (const token of previous) {
    if (seen.has(token)) continue;
    tokens.push({ slot: "previous", token });
    seen.add(token);
  }

  return tokens;
};

type AuthResult =
  | { ok: true; slot: TokenSlot }
  | { ok: false; status: 401 | 503; error: string };

const authenticateDeviceRequest = (req: Request): AuthResult => {
  const acceptedTokens = getAcceptedTokens();

  if (acceptedTokens.length === 0) {
    return {
      ok: false,
      status: 503,
      error: "Device ingest token is not configured.",
    };
  }

  const providedToken =
    req.get("x-device-key")?.trim() ||
    extractBearerToken(req.get("authorization"));

  if (!providedToken) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized: missing or invalid device token.",
    };
  }

  for (const { slot, token } of acceptedTokens) {
    if (tokensMatch(providedToken, token)) {
      return { ok: true, slot };
    }
  }

  return {
    ok: false,
    status: 401,
    error: "Unauthorized: missing or invalid device token.",
  };
};

router.get("/modbus/readings", async (req, res): Promise<void> => {
  const parsedQuery = ListModbusReadingsQueryParams.safeParse(req.query);

  if (!parsedQuery.success) {
    req.log.warn(
      { errors: parsedQuery.error.message },
      "Invalid Modbus readings query",
    );
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  const readings = await db
    .select()
    .from(modbusReadingsTable)
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
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

const authenticateDeviceRequest = (req: Request) => {
  const expectedToken = process.env[DEVICE_TOKEN_ENV]?.trim();

  if (!expectedToken) {
    return {
      ok: false,
      status: 503,
      error: "Device ingest token is not configured.",
    } as const;
  }

  const providedToken =
    req.get("x-device-key")?.trim() ||
    extractBearerToken(req.get("authorization"));

  if (!providedToken || !tokensMatch(providedToken, expectedToken)) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized: missing or invalid device token.",
    } as const;
  }

  return { ok: true } as const;
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
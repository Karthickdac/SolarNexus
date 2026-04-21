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

const getSource = (req: Request) => {
  const forwardedFor = req.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || req.ip || null;
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
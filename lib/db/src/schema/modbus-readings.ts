import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type ModbusRawPayload = Record<string, unknown>;
export type ModbusDecodedRegister = {
  address: string;
  name: string;
  unit: string | null;
  status: "decoded" | "unknown" | "invalid";
  value: string | number | boolean | null;
  rawValue: unknown;
  displayValue?: string;
  error?: string;
};
export type ModbusDecodedValues = {
  status:
    | "decoded"
    | "contains_unknown_registers"
    | "contains_invalid_registers"
    | "no_registers";
  registers: ModbusDecodedRegister[];
  providedValues: Record<string, unknown>;
};

export const modbusReadingsTable = pgTable("modbus_readings", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  source: text("source"),
  parsingStatus: text("parsing_status").notNull().default("accepted"),
  rawPayload: jsonb("raw_payload").$type<ModbusRawPayload>().notNull(),
  decodedValues: jsonb("decoded_values")
    .$type<ModbusDecodedValues>()
    .notNull()
    .default(sql`'{"status":"no_registers","registers":[],"providedValues":{}}'::jsonb`),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertModbusReadingSchema = createInsertSchema(
  modbusReadingsTable,
).omit({ id: true, receivedAt: true });

export type InsertModbusReading = z.infer<typeof insertModbusReadingSchema>;
export type ModbusReading = typeof modbusReadingsTable.$inferSelect;

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type ModbusRawPayload = Record<string, unknown>;

export const modbusReadingsTable = pgTable("modbus_readings", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  source: text("source"),
  parsingStatus: text("parsing_status").notNull().default("accepted"),
  rawPayload: jsonb("raw_payload").$type<ModbusRawPayload>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertModbusReadingSchema = createInsertSchema(
  modbusReadingsTable,
).omit({ id: true, receivedAt: true });

export type InsertModbusReading = z.infer<typeof insertModbusReadingSchema>;
export type ModbusReading = typeof modbusReadingsTable.$inferSelect;

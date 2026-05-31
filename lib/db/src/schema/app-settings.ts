import {
  pgTable,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * Single-row table holding SMTP configuration the super-admin can edit
 * from the dashboard. The row always has `id = 1`. The password column
 * is never returned over the API; only `passwordSet` is exposed.
 */
export const smtpSettingsTable = pgTable("smtp_settings", {
  id: integer("id").primaryKey(),
  host: text("host"),
  port: integer("port").notNull().default(587),
  username: text("username"),
  password: text("password"),
  fromAddress: text("from_address"),
  secure: boolean("secure").notNull().default(false),
  appBaseUrl: text("app_base_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: integer("updated_by"),
});

export type SmtpSettingsRow = typeof smtpSettingsTable.$inferSelect;

/**
 * Single-row table (always `id = 1`) holding the dashboard-editable
 * register → metric decode map for the TRB246. When no row is present the
 * decoder falls back to the built-in default map. `registerMap` is the
 * complete effective map (a JSON object keyed by Modbus register address).
 */
export const decoderSettingsTable = pgTable("decoder_settings", {
  id: integer("id").primaryKey(),
  registerMap: jsonb("register_map").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: integer("updated_by"),
});

export type DecoderSettingsRow = typeof decoderSettingsTable.$inferSelect;

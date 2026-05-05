import {
  pgTable,
  integer,
  text,
  boolean,
  timestamp,
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

import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type NotificationChannelKey = "inApp" | "webhook" | "email";

export type NotificationChannelConfig = {
  inApp: { enabled: boolean };
  webhook: { enabled: boolean; url: string };
  email: { enabled: boolean; to: string };
};

export const DEFAULT_CHANNEL_CONFIG: NotificationChannelConfig = {
  inApp: { enabled: true },
  webhook: { enabled: false, url: "" },
  email: { enabled: false, to: "" },
};

export const notificationSettingsTable = pgTable(
  "notification_settings",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("global"),
    enabled: boolean("enabled").notNull().default(true),
    thresholdMinutes: integer("threshold_minutes").notNull().default(30),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
    channels: jsonb("channels")
      .$type<NotificationChannelConfig>()
      .notNull()
      .default(sql`'${sql.raw(JSON.stringify(DEFAULT_CHANNEL_CONFIG))}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    scopeUnique: uniqueIndex("notification_settings_scope_unique").on(
      table.scope,
    ),
  }),
);

export type DeviceAlertSeverity = "warning" | "fault" | "resolved";

export type DeviceAlertChannelDispatch = {
  channel: NotificationChannelKey;
  status: "delivered" | "skipped" | "failed";
  detail?: string;
};

export const deviceAlertEventsTable = pgTable("device_alert_events", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  severity: text("severity").$type<DeviceAlertSeverity>().notNull(),
  minutesSinceData: integer("minutes_since_data").notNull(),
  thresholdMinutes: integer("threshold_minutes").notNull(),
  message: text("message").notNull(),
  dispatch: jsonb("dispatch")
    .$type<DeviceAlertChannelDispatch[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertNotificationSettingsSchema = createInsertSchema(
  notificationSettingsTable,
).omit({ id: true, updatedAt: true });

export const updateNotificationSettingsSchema = z.object({
  enabled: z.boolean(),
  thresholdMinutes: z.number().int().min(1).max(24 * 60),
  cooldownMinutes: z.number().int().min(1).max(24 * 60),
  channels: z.object({
    inApp: z.object({ enabled: z.boolean() }),
    webhook: z.object({
      enabled: z.boolean(),
      url: z.string().max(2048).default(""),
    }),
    email: z.object({
      enabled: z.boolean(),
      to: z.string().max(320).default(""),
    }),
  }),
});

export type NotificationSettings = typeof notificationSettingsTable.$inferSelect;
export type DeviceAlertEvent = typeof deviceAlertEventsTable.$inferSelect;
export type UpdateNotificationSettings = z.infer<
  typeof updateNotificationSettingsSchema
>;

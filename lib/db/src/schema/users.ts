import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type AppUserRole = "super-admin" | "operator";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").$type<AppUserRole>().notNull().default("operator"),
    passwordHash: text("password_hash").notNull(),
    siteIds: text("site_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique_idx").on(table.email),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type DbUser = typeof usersTable.$inferSelect;

export const sessionsTable = pgTable(
  "user_sessions",
  {
    id: serial("id").primaryKey(),
    token: text("token").notNull(),
    userId: serial("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    userAgent: text("user_agent"),
  },
  (table) => ({
    tokenUnique: uniqueIndex("user_sessions_token_unique_idx").on(table.token),
  }),
);

export type DbSession = typeof sessionsTable.$inferSelect;

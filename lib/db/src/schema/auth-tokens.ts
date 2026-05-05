import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  integer,
  index,
} from "drizzle-orm/pg-core";
import type { OrgRole } from "./organizations";

/** Hashed (sha-256) one-time password reset tokens. */
export const passwordResetsTable = pgTable(
  "password_resets",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: integer("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("password_resets_token_hash_unique_idx").on(
      table.tokenHash,
    ),
    userIdx: index("password_resets_user_idx").on(table.userId),
  }),
);
export type DbPasswordReset = typeof passwordResetsTable.$inferSelect;

/** Hashed (sha-256) invitation tokens. One outstanding invite per email per org. */
export const invitationsTable = pgTable(
  "invitations",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    orgId: integer("org_id").notNull(),
    email: text("email").notNull(),
    role: text("role").$type<OrgRole>().notNull().default("viewer"),
    invitedByUserId: integer("invited_by_user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("invitations_token_hash_unique_idx").on(
      table.tokenHash,
    ),
    orgIdx: index("invitations_org_idx").on(table.orgId),
  }),
);
export type DbInvitation = typeof invitationsTable.$inferSelect;

/**
 * Per-org API keys. The plaintext key (`sn_live_<32-hex>`) is shown to
 * the user exactly once at creation time and never stored. We persist
 * `key_hash` (sha-256 of the plaintext after the prefix) and `prefix`
 * (`sn_live_` + first 8 chars of the secret) so the user can identify
 * keys in the UI without exposing the secret.
 */
export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull(),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    label: text("label").notNull().default(""),
    createdByUserId: integer("created_by_user_id"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    keyHashUnique: uniqueIndex("api_keys_key_hash_unique_idx").on(
      table.keyHash,
    ),
    orgIdx: index("api_keys_org_idx").on(table.orgId),
  }),
);
export type DbApiKey = typeof apiKeysTable.$inferSelect;

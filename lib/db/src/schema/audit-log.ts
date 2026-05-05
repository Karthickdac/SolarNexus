import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export type AuditMetadata = Record<string, unknown>;

export const auditLogTable = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id"),
    actorUserId: integer("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata")
      .$type<AuditMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCreatedAtIdx: index("audit_log_org_created_at_idx").on(
      table.orgId,
      table.createdAt.desc(),
    ),
    actorIdx: index("audit_log_actor_idx").on(table.actorUserId),
  }),
);

export type DbAuditLog = typeof auditLogTable.$inferSelect;

import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  integer,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type OrgLimits = {
  maxMembers: number;
  maxApiKeys: number;
  maxReadingsPerMonth: number;
};

export const DEFAULT_ORG_LIMITS: OrgLimits = {
  maxMembers: 25,
  maxApiKeys: 10,
  maxReadingsPerMonth: 1_000_000,
};

/**
 * Org-level role hierarchy. Higher index = more privileges.
 * Use `roleAtLeast(actor, "admin")` for permission checks.
 */
export const ORG_ROLES = ["viewer", "operator", "admin", "owner"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export function roleAtLeast(actor: OrgRole | null | undefined, min: OrgRole): boolean {
  if (!actor) return false;
  return ORG_ROLES.indexOf(actor) >= ORG_ROLES.indexOf(min);
}

export const organizationsTable = pgTable(
  "organizations",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    limits: jsonb("limits")
      .$type<OrgLimits>()
      .notNull()
      .default(sql`'${sql.raw(JSON.stringify(DEFAULT_ORG_LIMITS))}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex("organizations_slug_unique_idx").on(table.slug),
  }),
);

export const insertOrganizationSchema = createInsertSchema(
  organizationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type DbOrganization = typeof organizationsTable.$inferSelect;

export const organizationMembershipsTable = pgTable(
  "organization_memberships",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    orgId: integer("org_id").notNull(),
    role: text("role").$type<OrgRole>().notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userOrgUnique: uniqueIndex(
      "organization_memberships_user_org_unique_idx",
    ).on(table.userId, table.orgId),
    orgIdx: index("organization_memberships_org_idx").on(table.orgId),
  }),
);

export type DbOrganizationMembership =
  typeof organizationMembershipsTable.$inferSelect;

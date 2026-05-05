import { and, eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  organizationMembershipsTable,
  auditLogTable,
  usersTable,
  ORG_ROLES,
  type OrgRole,
  type DbOrganization,
  type AuditMetadata,
} from "@workspace/db";
import { logger } from "./logger";

export const DEFAULT_ORG_SLUG = "default";
export const DEFAULT_ORG_NAME = "Default Organization";

export type Membership = {
  orgId: number;
  orgSlug: string;
  orgName: string;
  role: OrgRole;
};

/**
 * Idempotent and race-safe: ensures the default organization row exists
 * and returns it. Uses `onConflictDoNothing` so that two server instances
 * booting at the same time can't both error on the unique slug index.
 */
export async function ensureDefaultOrganization(): Promise<DbOrganization> {
  const insertResult = await db
    .insert(organizationsTable)
    .values({ slug: DEFAULT_ORG_SLUG, name: DEFAULT_ORG_NAME })
    .onConflictDoNothing({ target: organizationsTable.slug })
    .returning();
  if (insertResult[0]) {
    logger.info({ orgId: insertResult[0].id }, "Created default organization");
    return insertResult[0];
  }
  const existing = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.slug, DEFAULT_ORG_SLUG))
    .limit(1);
  if (!existing[0]) {
    throw new Error("Failed to create or load default organization.");
  }
  return existing[0];
}

/**
 * Idempotent and race-safe: ensures (userId, orgId) membership exists with
 * at least the given role. Never downgrades an existing higher role.
 * Uses `onConflictDoNothing` against the unique (user_id, org_id) index so
 * concurrent inserts don't crash the caller.
 */
export async function ensureMembership(
  userId: number,
  orgId: number,
  role: OrgRole,
): Promise<void> {
  const inserted = await db
    .insert(organizationMembershipsTable)
    .values({ userId, orgId, role })
    .onConflictDoNothing({
      target: [
        organizationMembershipsTable.userId,
        organizationMembershipsTable.orgId,
      ],
    })
    .returning();
  if (inserted[0]) return;
  // Row already existed — only upgrade, never downgrade.
  const existing = await db
    .select()
    .from(organizationMembershipsTable)
    .where(
      and(
        eq(organizationMembershipsTable.userId, userId),
        eq(organizationMembershipsTable.orgId, orgId),
      ),
    )
    .limit(1);
  if (!existing[0]) return;
  const currentRank = ORG_ROLES.indexOf(existing[0].role);
  const newRank = ORG_ROLES.indexOf(role);
  if (newRank > currentRank) {
    await db
      .update(organizationMembershipsTable)
      .set({ role })
      .where(eq(organizationMembershipsTable.id, existing[0].id));
  }
}

/**
 * Maps a legacy app-level user role to the appropriate org membership
 * role for the default-org backfill. Keeps least-privilege: only
 * `super-admin` becomes an org `owner`; regular `operator` accounts stay
 * `operator`. New roles added later default to `viewer`.
 */
function mapLegacyAppRoleToOrgRole(appRole: string): OrgRole {
  if (appRole === "super-admin") return "owner";
  if (appRole === "operator") return "operator";
  return "viewer";
}

/**
 * Backfill: place every existing user into the default org with a role
 * derived from their existing app-level role (least privilege). Safe to
 * call on every server boot; `ensureMembership` only upgrades, never
 * downgrades.
 */
export async function backfillExistingUsersIntoDefaultOrg(): Promise<void> {
  const org = await ensureDefaultOrganization();
  const users = await db.select().from(usersTable);
  for (const user of users) {
    await ensureMembership(user.id, org.id, mapLegacyAppRoleToOrgRole(user.role));
  }
}

/** Returns every organization the user is a member of, with their role. */
export async function getMembershipsForUser(
  userId: number,
): Promise<Membership[]> {
  const rows = await db
    .select({
      orgId: organizationsTable.id,
      orgSlug: organizationsTable.slug,
      orgName: organizationsTable.name,
      role: organizationMembershipsTable.role,
    })
    .from(organizationMembershipsTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, organizationMembershipsTable.orgId),
    )
    .where(eq(organizationMembershipsTable.userId, userId));
  return rows.map((row) => ({
    orgId: row.orgId,
    orgSlug: row.orgSlug,
    orgName: row.orgName,
    role: row.role,
  }));
}

/**
 * Best-effort audit-log insert. Never throws — failures are logged and
 * swallowed so the calling business operation isn't rolled back by an
 * audit failure.
 */
export async function recordAuditEvent(input: {
  orgId: number | null;
  actorUserId: number | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: AuditMetadata;
}): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    logger.warn({ err, action: input.action }, "Failed to write audit log");
  }
}

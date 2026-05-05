import { and, count, eq, gte, isNull } from "drizzle-orm";
import {
  db,
  organizationsTable,
  organizationMembershipsTable,
  apiKeysTable,
  modbusReadingsTable,
  type OrgLimits,
  DEFAULT_ORG_LIMITS,
} from "@workspace/db";

export async function getOrgLimits(orgId: number): Promise<OrgLimits> {
  const rows = await db
    .select({ limits: organizationsTable.limits })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId))
    .limit(1);
  return rows[0]?.limits ?? DEFAULT_ORG_LIMITS;
}

export type UsageSnapshot = {
  members: number;
  apiKeys: number;
  readingsThisMonth: number;
  limits: OrgLimits;
};

export async function getUsageSnapshot(orgId: number): Promise<UsageSnapshot> {
  const [members, apiKeys, readings, limits] = await Promise.all([
    db
      .select({ n: count() })
      .from(organizationMembershipsTable)
      .where(eq(organizationMembershipsTable.orgId, orgId))
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: count() })
      .from(apiKeysTable)
      .where(
        and(
          eq(apiKeysTable.orgId, orgId),
          isNull(apiKeysTable.revokedAt),
        ),
      )
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: count() })
      .from(modbusReadingsTable)
      .where(
        and(
          eq(modbusReadingsTable.orgId, orgId),
          gte(modbusReadingsTable.receivedAt, monthStart()),
        ),
      )
      .then((r) => Number(r[0]?.n ?? 0)),
    getOrgLimits(orgId),
  ]);
  return { members, apiKeys, readingsThisMonth: readings, limits };
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type LimitCheck =
  | { ok: true }
  | { ok: false; reason: string };

export async function checkMemberLimit(orgId: number): Promise<LimitCheck> {
  const snap = await getUsageSnapshot(orgId);
  if (snap.members >= snap.limits.maxMembers) {
    return {
      ok: false,
      reason: `Member limit reached (${snap.limits.maxMembers}). Contact the system administrator to raise the cap.`,
    };
  }
  return { ok: true };
}

export async function checkApiKeyLimit(orgId: number): Promise<LimitCheck> {
  const snap = await getUsageSnapshot(orgId);
  if (snap.apiKeys >= snap.limits.maxApiKeys) {
    return {
      ok: false,
      reason: `API key limit reached (${snap.limits.maxApiKeys}). Revoke an unused key first.`,
    };
  }
  return { ok: true };
}

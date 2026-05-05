import { and, desc, eq, isNull } from "drizzle-orm";
import { db, apiKeysTable, type DbApiKey } from "@workspace/db";
import { generateToken, hashToken } from "./token-utils";
import { recordAuditEvent } from "./org-service";

export const API_KEY_PREFIX = "sn_live_";

export type CreatedKey = {
  id: number;
  prefix: string;
  label: string;
  /** Plaintext key — only returned at creation time, never persisted. */
  secret: string;
  createdAt: string;
};

export async function createApiKey(input: {
  orgId: number;
  label: string;
  createdByUserId: number;
}): Promise<CreatedKey> {
  const secretSuffix = generateToken(24);
  const fullKey = `${API_KEY_PREFIX}${secretSuffix}`;
  const keyHash = hashToken(fullKey);
  const prefix = `${API_KEY_PREFIX}${secretSuffix.slice(0, 8)}`;
  const [row] = await db
    .insert(apiKeysTable)
    .values({
      orgId: input.orgId,
      keyHash,
      prefix,
      label: input.label.trim().slice(0, 200),
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!row) throw new Error("Failed to create API key.");
  void recordAuditEvent({
    orgId: input.orgId,
    actorUserId: input.createdByUserId,
    action: "api_keys.created",
    targetType: "api_key",
    targetId: String(row.id),
    metadata: { label: row.label, prefix: row.prefix },
  });
  return {
    id: row.id,
    prefix: row.prefix,
    label: row.label,
    secret: fullKey,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listApiKeys(orgId: number): Promise<DbApiKey[]> {
  return await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.orgId, orgId))
    .orderBy(desc(apiKeysTable.createdAt));
}

export async function revokeApiKey(input: {
  orgId: number;
  keyId: number;
  actorUserId: number;
}): Promise<boolean> {
  const [row] = await db
    .update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeysTable.id, input.keyId),
        eq(apiKeysTable.orgId, input.orgId),
        isNull(apiKeysTable.revokedAt),
      ),
    )
    .returning();
  if (!row) return false;
  void recordAuditEvent({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    action: "api_keys.revoked",
    targetType: "api_key",
    targetId: String(row.id),
    metadata: { prefix: row.prefix },
  });
  return true;
}

/**
 * Resolves a plaintext API key to the owning org id. Returns null when
 * the key is unknown, malformed, or revoked. Best-effort updates
 * `last_used_at` on success.
 */
export async function resolveApiKeyToOrg(
  key: string,
): Promise<{ orgId: number; keyId: number } | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  const keyHash = hashToken(key);
  const rows = await db
    .select()
    .from(apiKeysTable)
    .where(
      and(eq(apiKeysTable.keyHash, keyHash), isNull(apiKeysTable.revokedAt)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  db.update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, row.id))
    .catch(() => undefined);
  return { orgId: row.orgId, keyId: row.id };
}

/**
 * Tiny fetch wrapper for the SaaS surfaces (members, invitations, api
 * keys, audit log, usage). The generated api-client only covers the
 * pre-existing routes; rather than regenerate the OpenAPI spec for every
 * Phase 2-7 endpoint we hit them with bare fetch and the session token.
 */
import { getStoredToken } from "./auth";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `Request failed (${res.status}).`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type Member = {
  membershipId: number;
  userId: number;
  email: string;
  name: string;
  role: "viewer" | "operator" | "admin" | "owner";
  joinedAt: string;
};
export type PendingInvite = {
  id: number;
  email: string;
  role: "viewer" | "operator" | "admin" | "owner";
  expiresAt: string;
  createdAt: string;
};
export type ApiKeyRow = {
  id: number;
  prefix: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
export type CreatedApiKey = {
  id: number;
  prefix: string;
  label: string;
  secret: string;
  createdAt: string;
};
export type AuditEvent = {
  id: number;
  orgId: number | null;
  actorUserId: number | null;
  actor: { id: number; email: string; name: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};
export type Usage = {
  members: number;
  apiKeys: number;
  readingsThisMonth: number;
  limits: { maxMembers: number; maxApiKeys: number; maxReadingsPerMonth: number };
};

export const saasApi = {
  listMembers: (slug: string) =>
    request<{ members: Member[] }>("GET", `/orgs/${slug}/members`),
  setMemberRole: (slug: string, userId: number, role: string) =>
    request<{ ok: true }>("PATCH", `/orgs/${slug}/members/${userId}/role`, {
      role,
    }),
  removeMember: (slug: string, userId: number) =>
    request<{ ok: true }>("DELETE", `/orgs/${slug}/members/${userId}`),

  listInvites: (slug: string) =>
    request<{ invitations: PendingInvite[] }>(
      "GET",
      `/orgs/${slug}/invitations`,
    ),
  createInvite: (slug: string, email: string, role: string) =>
    request<{ ok: true; mailDispatched: boolean }>(
      "POST",
      `/orgs/${slug}/invitations`,
      { email, role },
    ),
  revokeInvite: (slug: string, id: number) =>
    request<{ ok: true }>("DELETE", `/orgs/${slug}/invitations/${id}`),

  listApiKeys: (slug: string) =>
    request<{ apiKeys: ApiKeyRow[] }>("GET", `/orgs/${slug}/api-keys`),
  createApiKey: (slug: string, label: string) =>
    request<{ apiKey: CreatedApiKey }>("POST", `/orgs/${slug}/api-keys`, {
      label,
    }),
  revokeApiKey: (slug: string, id: number) =>
    request<{ ok: true }>("DELETE", `/orgs/${slug}/api-keys/${id}`),

  listAudit: (slug: string, beforeId?: number) =>
    request<{ events: AuditEvent[] }>(
      "GET",
      `/orgs/${slug}/audit-log${beforeId ? `?beforeId=${beforeId}` : ""}`,
    ),

  getUsage: (slug: string) =>
    request<Usage>("GET", `/orgs/${slug}/usage`),
};

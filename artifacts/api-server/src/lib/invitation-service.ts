import { and, eq, isNull, gt, desc } from "drizzle-orm";
import {
  db,
  invitationsTable,
  organizationsTable,
  type OrgRole,
  type DbInvitation,
} from "@workspace/db";
import { generateToken, hashToken } from "./token-utils";
import { sendMail, getAppBaseUrl } from "./mailer";
import { findUserByEmail, createUser, type PublicUser } from "./auth-service";
import {
  ensureMembership,
  recordAuditEvent,
  getMembershipsForUser,
} from "./org-service";

const INVITE_TTL_DAYS = 7;

export type CreateInviteResult =
  | { ok: true; inviteId: number; mailDispatched: boolean }
  | { ok: false; status: number; error: string };

export async function createInvitation(input: {
  orgId: number;
  orgName: string;
  email: string;
  role: OrgRole;
  invitedByUserId: number;
}): Promise<CreateInviteResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, status: 400, error: "A valid email is required." };
  }
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const [row] = await db
    .insert(invitationsTable)
    .values({
      tokenHash,
      orgId: input.orgId,
      email,
      role: input.role,
      invitedByUserId: input.invitedByUserId,
      expiresAt,
    })
    .returning();
  if (!row) {
    return { ok: false, status: 500, error: "Failed to create invitation." };
  }
  const url = `${await getAppBaseUrl()}/accept-invite?token=${encodeURIComponent(token)}`;
  const dispatched = await sendMail({
    to: email,
    subject: `You're invited to join ${input.orgName} on SolarNexus`,
    text: [
      `You've been invited to join ${input.orgName} on SolarNexus as ${input.role}.`,
      "",
      `Accept the invite within ${INVITE_TTL_DAYS} days:`,
      url,
      "",
      "If you weren't expecting this email, you can safely ignore it.",
    ].join("\n"),
  });
  void recordAuditEvent({
    orgId: input.orgId,
    actorUserId: input.invitedByUserId,
    action: "members.invited",
    targetType: "invitation",
    targetId: String(row.id),
    metadata: { email, role: input.role },
  });
  return { ok: true, inviteId: row.id, mailDispatched: dispatched };
}

export type InviteSummary = {
  orgId: number;
  orgName: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
};

export async function getInvitationByToken(
  token: string,
): Promise<InviteSummary | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await db
    .select({
      invite: invitationsTable,
      orgName: organizationsTable.name,
    })
    .from(invitationsTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, invitationsTable.orgId),
    )
    .where(
      and(
        eq(invitationsTable.tokenHash, tokenHash),
        isNull(invitationsTable.acceptedAt),
        gt(invitationsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    orgId: row.invite.orgId,
    orgName: row.orgName,
    email: row.invite.email,
    role: row.invite.role,
    expiresAt: row.invite.expiresAt.toISOString(),
  };
}

export type AcceptResult =
  | { ok: true; user: PublicUser }
  | { ok: false; status: number; error: string };

export async function acceptInvitation(input: {
  token: string;
  name: string;
  password: string;
}): Promise<AcceptResult> {
  const summary = await getInvitationByToken(input.token);
  if (!summary) {
    return {
      ok: false,
      status: 400,
      error: "This invitation link is invalid or has expired.",
    };
  }
  if (!input.name?.trim() || !input.password || input.password.length < 8) {
    return {
      ok: false,
      status: 400,
      error: "Name and a password of at least 8 characters are required.",
    };
  }
  // CAS the invitation to accepted FIRST. Only the winning request gets
  // a returned row; concurrent duplicates fall through with an error and
  // never create a second membership/user.
  const tokenHash = hashToken(input.token);
  const claimed = await db
    .update(invitationsTable)
    .set({ acceptedAt: new Date() })
    .where(
      and(
        eq(invitationsTable.tokenHash, tokenHash),
        isNull(invitationsTable.acceptedAt),
        gt(invitationsTable.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!claimed[0]) {
    return {
      ok: false,
      status: 400,
      error: "This invitation link is invalid or has expired.",
    };
  }
  const existing = await findUserByEmail(summary.email);
  const user: PublicUser = existing
    ? {
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role: existing.role,
        siteIds: existing.siteIds ?? [],
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      }
    : await createUser({
        email: summary.email,
        name: input.name.trim(),
        role: "operator",
        password: input.password,
      });
  await ensureMembership(user.id, summary.orgId, summary.role);
  void recordAuditEvent({
    orgId: summary.orgId,
    actorUserId: user.id,
    action: "members.invitation_accepted",
    targetType: "user",
    targetId: String(user.id),
  });
  return { ok: true, user };
}

export async function listPendingInvitations(
  orgId: number,
): Promise<DbInvitation[]> {
  return await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.orgId, orgId),
        isNull(invitationsTable.acceptedAt),
        gt(invitationsTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitationsTable.createdAt));
}

export async function revokeInvitation(
  orgId: number,
  inviteId: number,
  actorUserId: number,
): Promise<boolean> {
  const result = await db
    .delete(invitationsTable)
    .where(
      and(
        eq(invitationsTable.id, inviteId),
        eq(invitationsTable.orgId, orgId),
      ),
    )
    .returning();
  if (result[0]) {
    void recordAuditEvent({
      orgId,
      actorUserId,
      action: "members.invitation_revoked",
      targetType: "invitation",
      targetId: String(inviteId),
    });
    return true;
  }
  return false;
}

// Re-export so route files can avoid importing from two places.
export { getMembershipsForUser };

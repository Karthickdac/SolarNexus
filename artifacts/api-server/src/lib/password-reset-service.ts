import { and, eq, isNull, gt } from "drizzle-orm";
import { db, passwordResetsTable, usersTable } from "@workspace/db";
import { generateToken, hashToken } from "./token-utils";
import { hashPassword, findUserByEmail } from "./auth-service";
import { sendMail, getAppBaseUrl } from "./mailer";
import { recordAuditEvent, getMembershipsForUser } from "./org-service";
import { logger } from "./logger";

const RESET_TTL_MINUTES = 30;

/**
 * Creates a new password reset token for the given email and emails the
 * link. Always returns void so the public route can respond identically
 * for known and unknown emails (no enumeration).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user) return;
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
  await db
    .insert(passwordResetsTable)
    .values({ tokenHash, userId: user.id, expiresAt });
  const url = `${await getAppBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: "Reset your SolarNexus password",
    text: [
      `Hi ${user.name || user.email},`,
      "",
      "We received a request to reset your SolarNexus password.",
      `Open this link within ${RESET_TTL_MINUTES} minutes to choose a new password:`,
      url,
      "",
      "If you didn't request this, you can ignore this email — your password won't change.",
    ].join("\n"),
  });
  const memberships = await getMembershipsForUser(user.id);
  void recordAuditEvent({
    orgId: memberships[0]?.orgId ?? null,
    actorUserId: user.id,
    action: "auth.password_reset.requested",
    targetType: "user",
    targetId: String(user.id),
  });
  logger.info({ userId: user.id }, "Password reset requested");
}

export type ConfirmResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<ConfirmResult> {
  if (!token || !newPassword || newPassword.length < 8) {
    return {
      ok: false,
      status: 400,
      error: "Token and a password of at least 8 characters are required.",
    };
  }
  const tokenHash = hashToken(token);
  // Atomically mark the token as used so a concurrent confirm with the
  // same token can never succeed twice. The CAS only flips usedAt when
  // it is still null AND the token hasn't expired, so we trust the
  // returned row to be ours.
  const claimed = await db
    .update(passwordResetsTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetsTable.tokenHash, tokenHash),
        isNull(passwordResetsTable.usedAt),
        gt(passwordResetsTable.expiresAt, new Date()),
      ),
    )
    .returning();
  const reset = claimed[0];
  if (!reset) {
    return { ok: false, status: 400, error: "This reset link is invalid or has expired." };
  }
  const passwordHash = await hashPassword(newPassword);
  await db
    .update(usersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(usersTable.id, reset.userId));
  const memberships = await getMembershipsForUser(reset.userId);
  void recordAuditEvent({
    orgId: memberships[0]?.orgId ?? null,
    actorUserId: reset.userId,
    action: "auth.password_reset.confirmed",
    targetType: "user",
    targetId: String(reset.userId),
  });
  return { ok: true };
}

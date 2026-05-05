import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, usersTable, sessionsTable } from "@workspace/db";
import type { DbUser, AppUserRole } from "@workspace/db";
import { logger } from "./logger";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEY_LENGTH = 64;

const parseTtlHours = (raw: string | undefined): number => {
  if (!raw || !raw.trim()) return 168; // 7 days
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) {
    logger.warn(
      { raw },
      "Invalid AUTH_SESSION_TTL_HOURS; falling back to 168 (7 days)",
    );
    return 168;
  }
  return n;
};
const SESSION_TTL_HOURS = parseTtlHours(process.env.AUTH_SESSION_TTL_HOURS);
const SESSION_TOKEN_BYTES = 32;

// Pre-computed dummy hash with the same scrypt cost and key length as
// real hashes. Used by `loginWithPassword` for unknown emails so the
// timing of the unknown-user path matches the wrong-password path and
// attackers can't enumerate accounts via response-time differences.
const DUMMY_HASH_PROMISE: Promise<string> = (async () => {
  const salt = randomBytes(16);
  const derived = await scrypt(
    "agent-relay-dummy-password-do-not-use",
    salt,
    SCRYPT_KEY_LENGTH,
  );
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
})();

export const PUBLIC_USER_FIELDS = {
  id: usersTable.id,
  email: usersTable.email,
  name: usersTable.name,
  role: usersTable.role,
  siteIds: usersTable.siteIds,
  createdAt: usersTable.createdAt,
  updatedAt: usersTable.updatedAt,
} as const;

export type PublicUser = {
  id: number;
  email: string;
  name: string;
  role: AppUserRole;
  siteIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

const toPublic = (user: DbUser): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  siteIds: user.siteIds ?? [],
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (!plain || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const saltHex = parts[1] ?? "";
  const expectedHex = parts[2] ?? "";
  if (!saltHex || !expectedHex) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  const derived = await scrypt(plain, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function findUserByEmail(
  email: string,
): Promise<DbUser | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizeEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<DbUser | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  name: string;
  role: AppUserRole;
  password: string;
  siteIds?: string[];
}): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      role: input.role,
      passwordHash,
      siteIds: input.siteIds ?? [],
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create user.");
  }
  return toPublic(row);
}

export type LoginResult =
  | { ok: true; user: PublicUser; token: string; expiresAt: Date }
  | { ok: false; status: number; error: string };

export async function loginWithPassword(
  email: string,
  password: string,
  userAgent: string | null,
): Promise<LoginResult> {
  const user = await findUserByEmail(email);
  if (!user) {
    // Run a full-cost dummy verify so the unknown-user path takes
    // roughly the same wall time as a wrong-password path. This
    // prevents attackers from enumerating valid emails by timing the
    // login endpoint.
    const dummy = await DUMMY_HASH_PROMISE;
    await verifyPassword(password, dummy).catch(() => false);
    return { ok: false, status: 401, error: "Invalid email or password." };
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { ok: false, status: 401, error: "Invalid email or password." };
  }
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000,
  );
  await db.insert(sessionsTable).values({
    token,
    userId: user.id,
    expiresAt,
    userAgent: userAgent?.slice(0, 512) ?? null,
  });
  return { ok: true, user: toPublic(user), token, expiresAt };
}

export async function findUserBySessionToken(
  token: string,
): Promise<PublicUser | null> {
  if (!token) return null;
  const rows = await db
    .select({ user: usersTable, expiresAt: sessionsTable.expiresAt })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(
      and(
        eq(sessionsTable.token, token),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Best-effort touch of last_seen_at.
  db.update(sessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessionsTable.token, token))
    .catch(() => undefined);
  return toPublic(row.user);
}

export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
}

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await db
    .select()
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));
  return rows.map(toPublic);
}

/**
 * Ensures a default super-admin exists if `DEFAULT_ADMIN_EMAIL` and
 * `DEFAULT_ADMIN_PASSWORD` are set. Idempotent: if a user with that email
 * already exists, the password is NOT overwritten.
 *
 * In `NODE_ENV=development`/`test` we additionally fall back to a built-in
 * dev admin (`admin@local.dev` / `password123`) so the desktop client can
 * authenticate against a freshly-cloned project without extra setup.
 */
export async function seedDefaultAdmin(): Promise<void> {
  const envEmail = process.env.DEFAULT_ADMIN_EMAIL?.trim();
  const envPassword = process.env.DEFAULT_ADMIN_PASSWORD?.trim();
  const isLocal =
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

  const candidates: Array<{ email: string; password: string; name: string }> =
    [];
  if (envEmail && envPassword) {
    candidates.push({
      email: envEmail,
      password: envPassword,
      name: process.env.DEFAULT_ADMIN_NAME?.trim() || "Super Admin",
    });
  }
  if (isLocal && !envEmail) {
    candidates.push({
      email: "admin@local.dev",
      password: "password123",
      name: "Local Dev Admin",
    });
  }

  for (const candidate of candidates) {
    try {
      const existing = await findUserByEmail(candidate.email);
      if (existing) continue;
      await createUser({
        email: candidate.email,
        name: candidate.name,
        role: "super-admin",
        password: candidate.password,
      });
      logger.info(
        { email: candidate.email },
        "Seeded default super-admin user",
      );
    } catch (err) {
      logger.warn({ err, email: candidate.email }, "Failed to seed admin user");
    }
  }
}

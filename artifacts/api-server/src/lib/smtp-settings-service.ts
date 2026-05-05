import { eq } from "drizzle-orm";
import { db, smtpSettingsTable, type SmtpSettingsRow } from "@workspace/db";

export type SmtpSettingsInput = {
  host: string | null;
  port: number;
  username: string | null;
  password: string | null;
  fromAddress: string | null;
  secure: boolean;
  appBaseUrl: string | null;
};

export type SmtpSettingsView = Omit<SmtpSettingsInput, "password"> & {
  passwordSet: boolean;
  updatedAt: string | null;
};

let cached: SmtpSettingsRow | null | undefined = undefined;

export function invalidateSmtpSettingsCache() {
  cached = undefined;
}

export async function loadSmtpSettings(): Promise<SmtpSettingsRow | null> {
  if (cached !== undefined) return cached;
  const rows = await db
    .select()
    .from(smtpSettingsTable)
    .where(eq(smtpSettingsTable.id, 1))
    .limit(1);
  cached = rows[0] ?? null;
  return cached;
}

export async function getSmtpSettingsView(): Promise<SmtpSettingsView> {
  const row = await loadSmtpSettings();
  return {
    host: row?.host ?? null,
    port: row?.port ?? 587,
    username: row?.username ?? null,
    fromAddress: row?.fromAddress ?? null,
    secure: row?.secure ?? false,
    appBaseUrl: row?.appBaseUrl ?? null,
    passwordSet: Boolean(row?.password),
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/**
 * Upsert the singleton row. When `password === undefined` the existing
 * password is preserved; pass an empty string to clear it.
 */
export async function saveSmtpSettings(
  input: Omit<SmtpSettingsInput, "password"> & { password?: string | null },
  updatedBy: number | null,
): Promise<void> {
  const existing = await loadSmtpSettings();
  const nextPassword =
    input.password === undefined ? existing?.password ?? null : input.password || null;
  const values = {
    id: 1,
    host: input.host?.trim() || null,
    port: input.port,
    username: input.username?.trim() || null,
    password: nextPassword,
    fromAddress: input.fromAddress?.trim() || null,
    secure: input.secure,
    appBaseUrl: input.appBaseUrl?.trim().replace(/\/+$/, "") || null,
    updatedAt: new Date(),
    updatedBy,
  };
  if (existing) {
    await db
      .update(smtpSettingsTable)
      .set(values)
      .where(eq(smtpSettingsTable.id, 1));
  } else {
    await db.insert(smtpSettingsTable).values(values);
  }
  invalidateSmtpSettingsCache();
}

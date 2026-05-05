import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";
import { loadSmtpSettings } from "./smtp-settings-service";

let cachedTransporter: Transporter | null = null;
let cachedConfigSig: string | null = null;

type ResolvedSmtp = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  secure: boolean;
};

async function readSmtpConfig(): Promise<ResolvedSmtp | null> {
  // 1. DB-managed settings (super-admin editable in the dashboard).
  const row = await loadSmtpSettings();
  if (row?.host && row.fromAddress) {
    const port = row.port && Number.isFinite(row.port) ? row.port : 587;
    return {
      host: row.host,
      port,
      user: row.username ?? undefined,
      pass: row.password ?? undefined,
      from: row.fromAddress,
      secure: row.secure,
    };
  }
  // 2. Env fallback (legacy / bootstrap).
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const secure = process.env.SMTP_SECURE?.trim().toLowerCase() === "true";
  if (!host || !from) return null;
  const port = portRaw ? Number(portRaw) : 587;
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host, port, user, pass, from, secure };
}

async function getTransporter(): Promise<{
  transporter: Transporter;
  cfg: ResolvedSmtp;
} | null> {
  const cfg = await readSmtpConfig();
  if (!cfg) return null;
  const sig = JSON.stringify(cfg);
  if (cachedTransporter && cachedConfigSig === sig) {
    return { transporter: cachedTransporter, cfg };
  }
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  cachedConfigSig = sig;
  return { transporter: cachedTransporter, cfg };
}

export async function isMailerConfigured(): Promise<boolean> {
  return (await readSmtpConfig()) !== null;
}

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * Sends mail via the configured SMTP server. When SMTP is NOT
 * configured (e.g. local dev), falls back to logging the body so
 * developers can still copy reset/invite links from the server log.
 * Returns true when a mail was actually dispatched.
 */
export async function sendMail(input: SendMailInput): Promise<boolean> {
  const resolved = await getTransporter();
  if (!resolved) {
    logger.info(
      { to: input.to, subject: input.subject, body: input.text },
      "[mailer] SMTP not configured, logging mail body instead",
    );
    return false;
  }
  try {
    await resolved.transporter.sendMail({
      from: resolved.cfg.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return true;
  } catch (err) {
    logger.error({ err, to: input.to }, "Failed to send mail");
    return false;
  }
}

/**
 * Sends a one-off test mail using a caller-supplied transient config,
 * bypassing both the DB and env. Used by the SMTP settings "Send test"
 * action so super-admins can validate credentials before saving.
 */
export async function sendTestMail(opts: {
  to: string;
  config: {
    host: string;
    port: number;
    secure: boolean;
    username?: string | null;
    password?: string | null;
    fromAddress: string;
  };
}): Promise<{ ok: boolean; error?: string }> {
  const { config, to } = opts;
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth:
        config.username && config.password
          ? { user: config.username, pass: config.password }
          : undefined,
    });
    await transporter.sendMail({
      from: config.fromAddress,
      to,
      subject: "SolarNexus SMTP test",
      text:
        "This is a test message from your SolarNexus dashboard. " +
        "If you can read this, your SMTP settings are working correctly.",
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, to }, "SMTP test send failed");
    return { ok: false, error: message };
  }
}

/** Public-facing base URL of the dashboard (used for links in mails). */
export async function getAppBaseUrl(): Promise<string> {
  const row = await loadSmtpSettings();
  const fromDb = row?.appBaseUrl?.trim().replace(/\/+$/, "");
  if (fromDb) return fromDb;
  const raw = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  return raw || "http://localhost:5000";
}

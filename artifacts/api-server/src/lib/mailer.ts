import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

let cachedTransporter: Transporter | null = null;
let cachedConfigSig: string | null = null;

function readSmtpConfig() {
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

function getTransporter(): Transporter | null {
  const cfg = readSmtpConfig();
  if (!cfg) return null;
  const sig = JSON.stringify(cfg);
  if (cachedTransporter && cachedConfigSig === sig) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  cachedConfigSig = sig;
  return cachedTransporter;
}

export function isMailerConfigured(): boolean {
  return readSmtpConfig() !== null;
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
  const cfg = readSmtpConfig();
  if (!cfg) {
    logger.info(
      { to: input.to, subject: input.subject, body: input.text },
      "[mailer] SMTP not configured, logging mail body instead",
    );
    return false;
  }
  const transporter = getTransporter();
  if (!transporter) return false;
  try {
    await transporter.sendMail({
      from: cfg.from,
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

/** Public-facing base URL of the dashboard (used for links in mails). */
export function getAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  return raw || "http://localhost:5000";
}

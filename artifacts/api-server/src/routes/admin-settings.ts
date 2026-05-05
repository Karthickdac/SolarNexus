import { Router, type IRouter, type Request, type Response } from "express";
import { requireUserSession } from "../lib/admin-auth";
import {
  getSmtpSettingsView,
  saveSmtpSettings,
  loadSmtpSettings,
} from "../lib/smtp-settings-service";
import { sendTestMail } from "../lib/mailer";
import { recordAuditEvent } from "../lib/org-service";
import { logger } from "../lib/logger";
import { resolveAndValidateWebhookHost } from "../lib/webhook-guard";

const router: IRouter = Router();

function requireSuperAdmin(req: Request, res: Response): boolean {
  if (req.authenticatedUser?.role !== "super-admin") {
    res.status(403).json({ error: "Super-admin access required." });
    return false;
  }
  return true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SmtpInput = {
  host: string | null;
  port: number;
  username: string | null;
  password: string | null | undefined;
  fromAddress: string | null;
  secure: boolean;
  appBaseUrl: string | null;
};

function parseSmtpInput(body: unknown):
  | { ok: true; data: SmtpInput }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be an object." };
  }
  const b = body as Record<string, unknown>;
  const trimOrNull = (v: unknown, max: number) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    if (t.length > max) return undefined;
    return t || null;
  };
  const host = trimOrNull(b.host, 255);
  const username = trimOrNull(b.username, 255);
  const fromAddress = trimOrNull(b.fromAddress, 255);
  const appBaseUrl = trimOrNull(b.appBaseUrl, 512);
  if (host === undefined) return { ok: false, error: "host is invalid." };
  if (username === undefined) return { ok: false, error: "username is invalid." };
  if (fromAddress === undefined) {
    return { ok: false, error: "fromAddress is invalid." };
  }
  if (appBaseUrl === undefined) {
    return { ok: false, error: "appBaseUrl is invalid." };
  }
  let port = 587;
  if (b.port !== undefined && b.port !== null && b.port !== "") {
    const n = Number(b.port);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) {
      return { ok: false, error: "port must be an integer between 1 and 65535." };
    }
    port = n;
  }
  let password: string | null | undefined = undefined;
  if (b.password === null || b.password === "") {
    password = null;
  } else if (typeof b.password === "string") {
    if (b.password.length > 1024) {
      return { ok: false, error: "password is too long." };
    }
    password = b.password;
  } else if (b.password !== undefined) {
    return { ok: false, error: "password must be a string or null." };
  }
  const secure = Boolean(b.secure);
  return {
    ok: true,
    data: { host, port, username, password, fromAddress, secure, appBaseUrl },
  };
}

router.get("/admin/smtp-settings", requireUserSession, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const view = await getSmtpSettingsView();
  res.json(view);
});

router.put("/admin/smtp-settings", requireUserSession, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const parsed = parseSmtpInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  // SSRF guard: even though only super-admins can reach this route, never
  // allow an SMTP host that resolves to a loopback / RFC1918 / link-local
  // address. The same defence is applied to outbound webhooks; we reuse it
  // here so a compromised super-admin (or a misconfigured host) cannot be
  // turned into an internal port-scanner via the SMTP transport.
  if (parsed.data.host) {
    const hostCheck = await resolveAndValidateWebhookHost(parsed.data.host);
    if (!hostCheck.ok) {
      res.status(400).json({
        error: hostCheck.reason.replace(/^Webhook /, "SMTP "),
      });
      return;
    }
  }
  await saveSmtpSettings(parsed.data, req.authenticatedUser!.id);
  void recordAuditEvent({
    orgId: null,
    actorUserId: req.authenticatedUser!.id,
    action: "admin.smtp_settings_updated",
    targetType: "smtp_settings",
    targetId: "1",
    metadata: { host: parsed.data.host },
  }).catch((err) =>
    logger.warn({ err }, "audit log failed for smtp_settings_updated"),
  );
  const view = await getSmtpSettingsView();
  res.json(view);
});

router.post(
  "/admin/smtp-settings/test",
  requireUserSession,
  async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const to = (req.body as { to?: unknown })?.to;
    if (typeof to !== "string" || !EMAIL_RE.test(to.trim())) {
      res.status(400).json({ error: "A valid recipient email is required." });
      return;
    }
    const row = await loadSmtpSettings();
    if (!row?.host || !row.fromAddress) {
      res
        .status(400)
        .json({ error: "Save SMTP host and From address before sending a test." });
      return;
    }
    const result = await sendTestMail({
      to: to.trim(),
      config: {
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        password: row.password,
        fromAddress: row.fromAddress,
      },
    });
    if (!result.ok) {
      res.status(502).json({ error: result.error ?? "SMTP send failed." });
      return;
    }
    res.json({ ok: true });
  },
);

export default router;

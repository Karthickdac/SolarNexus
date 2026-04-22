import { Router, type IRouter } from "express";
import { updateNotificationSettingsSchema } from "@workspace/db";
import {
  dispatchAlert,
  evaluateAndDispatch,
  getOrCreateNotificationSettings,
  listAlertEvents,
  updateNotificationSettings,
} from "../lib/alerts-service";
import { requireAdminAuth } from "../lib/admin-auth";
import {
  resolveAndValidateWebhookHost,
  validateWebhookUrl,
} from "../lib/webhook-guard";

const router: IRouter = Router();

router.get("/alerts/preferences", async (_req, res, next) => {
  try {
    const settings = await getOrCreateNotificationSettings();
    res.json({ preferences: settings });
  } catch (err) {
    next(err);
  }
});

router.put("/alerts/preferences", requireAdminAuth, async (req, res, next) => {
  try {
    const parsed = updateNotificationSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid notification preferences payload.",
        details: parsed.error.issues,
      });
      return;
    }
    if (parsed.data.channels.webhook.enabled) {
      const url = parsed.data.channels.webhook.url;
      if (!url) {
        res
          .status(400)
          .json({ error: "Webhook channel is enabled but URL is empty." });
        return;
      }
      const guard = validateWebhookUrl(url);
      if (!guard.ok) {
        res.status(400).json({ error: guard.reason });
        return;
      }
      const dnsGuard = await resolveAndValidateWebhookHost(
        guard.url.hostname.replace(/^\[|\]$/g, ""),
      );
      if (!dnsGuard.ok) {
        res.status(400).json({ error: dnsGuard.reason });
        return;
      }
    }
    const settings = await updateNotificationSettings(parsed.data);
    res.json({ preferences: settings });
  } catch (err) {
    next(err);
  }
});

router.get("/alerts/events", async (req, res, next) => {
  try {
    const limit = Number(req.query["limit"] ?? 50);
    const since =
      typeof req.query["since"] === "string" ? req.query["since"] : undefined;
    const events = await listAlertEvents(
      Number.isFinite(limit) ? limit : 50,
      since,
    );
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

router.post("/alerts/test", requireAdminAuth, async (req, res, next) => {
  try {
    const deviceId =
      (typeof req.body?.deviceId === "string" && req.body.deviceId.trim()) ||
      "test-device";
    const settings = await getOrCreateNotificationSettings();
    const event = await dispatchAlert({
      deviceId,
      severity: "warning",
      minutesSinceData: settings.thresholdMinutes,
      thresholdMinutes: settings.thresholdMinutes,
      channels: settings.channels,
      trigger: "manual",
    });
    res.json({ event });
  } catch (err) {
    next(err);
  }
});

router.post("/alerts/evaluate", requireAdminAuth, async (_req, res, next) => {
  try {
    const result = await evaluateAndDispatch();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;

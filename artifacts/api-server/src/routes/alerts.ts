import { Router, type IRouter } from "express";
import { updateNotificationSettingsSchema } from "@workspace/db";
import {
  clearSiteDeviceAssignments,
  deleteSiteThreshold,
  dispatchAlert,
  evaluateAndDispatch,
  getOrCreateNotificationSettings,
  isValidSiteId,
  listAlertEvents,
  listDeviceSiteAssignments,
  listSiteThresholds,
  replaceSiteDeviceAssignments,
  updateNotificationSettings,
  upsertSiteThreshold,
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

router.get("/alerts/site-thresholds", async (_req, res, next) => {
  try {
    const thresholds = await listSiteThresholds();
    res.json({ thresholds });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/alerts/site-thresholds",
  requireAdminAuth,
  async (req, res, next) => {
    try {
      const siteId =
        typeof req.body?.siteId === "string" ? req.body.siteId.trim() : "";
      const thresholdMinutes = Number(req.body?.thresholdMinutes);
      const cooldownRaw = req.body?.cooldownMinutes;
      const cooldownProvided =
        cooldownRaw !== undefined && cooldownRaw !== null;
      const cooldownMinutes = cooldownProvided ? Number(cooldownRaw) : undefined;
      if (!isValidSiteId(siteId)) {
        res.status(400).json({
          error:
            "siteId must be 1-128 chars of letters, digits, dot, dash, or underscore.",
        });
        return;
      }
      if (
        !Number.isInteger(thresholdMinutes) ||
        thresholdMinutes < 1 ||
        thresholdMinutes > 1440
      ) {
        res.status(400).json({
          error: "thresholdMinutes must be an integer between 1 and 1440.",
        });
        return;
      }
      if (
        cooldownProvided &&
        (!Number.isInteger(cooldownMinutes) ||
          (cooldownMinutes as number) < 1 ||
          (cooldownMinutes as number) > 1440)
      ) {
        res.status(400).json({
          error: "cooldownMinutes must be an integer between 1 and 1440.",
        });
        return;
      }
      const threshold = await upsertSiteThreshold(
        siteId,
        thresholdMinutes,
        cooldownMinutes,
      );
      res.json({ threshold });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/alerts/site-thresholds/:siteId",
  requireAdminAuth,
  async (req, res, next) => {
    try {
      const rawSiteId = req.params["siteId"];
      const siteId = typeof rawSiteId === "string" ? rawSiteId : "";
      if (!isValidSiteId(siteId)) {
        res.status(400).json({ error: "Invalid siteId." });
        return;
      }
      await deleteSiteThreshold(siteId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

router.get("/alerts/site-devices", async (_req, res, next) => {
  try {
    const assignments = await listDeviceSiteAssignments();
    res.json({ assignments });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/alerts/site-devices/:siteId",
  requireAdminAuth,
  async (req, res, next) => {
    try {
      const rawSiteId = req.params["siteId"];
      const siteId = typeof rawSiteId === "string" ? rawSiteId : "";
      if (!isValidSiteId(siteId)) {
        res.status(400).json({ error: "Invalid siteId." });
        return;
      }
      const rawDeviceIds = req.body?.deviceIds;
      if (!Array.isArray(rawDeviceIds)) {
        res
          .status(400)
          .json({ error: "deviceIds must be an array of strings." });
        return;
      }
      if (!rawDeviceIds.every((id: unknown) => typeof id === "string")) {
        res.status(400).json({
          error:
            "deviceIds must contain only strings; reject arrays with mixed types so removals are explicit.",
        });
        return;
      }
      const deviceIds = rawDeviceIds as string[];
      try {
        const assignments = await replaceSiteDeviceAssignments(
          siteId,
          deviceIds,
        );
        res.json({ assignments });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update assignments.";
        if (message.startsWith("Invalid deviceId")) {
          res.status(400).json({ error: message });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/alerts/site-devices/:siteId",
  requireAdminAuth,
  async (req, res, next) => {
    try {
      const rawSiteId = req.params["siteId"];
      const siteId = typeof rawSiteId === "string" ? rawSiteId : "";
      if (!isValidSiteId(siteId)) {
        res.status(400).json({ error: "Invalid siteId." });
        return;
      }
      await clearSiteDeviceAssignments(siteId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

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

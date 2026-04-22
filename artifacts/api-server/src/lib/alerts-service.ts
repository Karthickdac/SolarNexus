import { desc, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  deviceAlertEventsTable,
  modbusReadingsTable,
  notificationSettingsTable,
  DEFAULT_CHANNEL_CONFIG,
  type DeviceAlertChannelDispatch,
  type DeviceAlertSeverity,
  type NotificationChannelConfig,
  type NotificationSettings,
  type UpdateNotificationSettings,
} from "@workspace/db";
import { logger } from "./logger";
import {
  resolveAndValidateWebhookHost,
  safeOutboundDispatcher,
  validateWebhookUrl,
} from "./webhook-guard";

const GLOBAL_SCOPE = "global";

export const getOrCreateNotificationSettings =
  async (): Promise<NotificationSettings> => {
    const [existing] = await db
      .select()
      .from(notificationSettingsTable)
      .where(sql`${notificationSettingsTable.scope} = ${GLOBAL_SCOPE}`)
      .limit(1);

    if (existing) return existing;

    const [created] = await db
      .insert(notificationSettingsTable)
      .values({
        scope: GLOBAL_SCOPE,
        enabled: true,
        thresholdMinutes: 30,
        cooldownMinutes: 60,
        channels: DEFAULT_CHANNEL_CONFIG,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to initialize notification settings");
    }
    return created;
  };

export const updateNotificationSettings = async (
  input: UpdateNotificationSettings,
): Promise<NotificationSettings> => {
  await getOrCreateNotificationSettings();
  const [updated] = await db
    .update(notificationSettingsTable)
    .set({
      enabled: input.enabled,
      thresholdMinutes: input.thresholdMinutes,
      cooldownMinutes: input.cooldownMinutes,
      channels: input.channels as NotificationChannelConfig,
      updatedAt: new Date(),
    })
    .where(sql`${notificationSettingsTable.scope} = ${GLOBAL_SCOPE}`)
    .returning();
  if (!updated) throw new Error("Failed to update notification settings");
  return updated;
};

export const listAlertEvents = async (limit = 50, sinceIso?: string) => {
  const filters = [] as ReturnType<typeof gte>[];
  if (sinceIso) {
    const since = new Date(sinceIso);
    if (!Number.isNaN(since.getTime())) {
      filters.push(gte(deviceAlertEventsTable.createdAt, since));
    }
  }
  const query = db
    .select()
    .from(deviceAlertEventsTable)
    .orderBy(desc(deviceAlertEventsTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  const where = filters.length ? query.where(filters[0]!) : query;
  return where;
};

const dispatchInApp = (): DeviceAlertChannelDispatch => ({
  channel: "inApp",
  status: "delivered",
  detail: "Visible in dashboard alerts feed.",
});

const dispatchWebhook = async (
  url: string,
  body: Record<string, unknown>,
): Promise<DeviceAlertChannelDispatch> => {
  if (!url) {
    return {
      channel: "webhook",
      status: "skipped",
      detail: "Webhook URL is not configured.",
    };
  }
  const guard = validateWebhookUrl(url);
  if (!guard.ok) {
    return { channel: "webhook", status: "failed", detail: guard.reason };
  }
  const dnsGuard = await resolveAndValidateWebhookHost(
    guard.url.hostname.replace(/^\[|\]$/g, ""),
  );
  if (!dnsGuard.ok) {
    return { channel: "webhook", status: "failed", detail: dnsGuard.reason };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    // Pin DNS resolution to addresses validated against the SSRF policy so
    // a hostname cannot rebind between validation and TCP connect. The
    // `dispatcher` option is supported by Node's undici-backed fetch but
    // is not present in the public lib.dom fetch typings.
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
      dispatcher: safeOutboundDispatcher,
    } as unknown as RequestInit;
    const response = await fetch(guard.url.toString(), init);
    if (response.status >= 300 && response.status < 400) {
      return {
        channel: "webhook",
        status: "failed",
        detail: `Webhook returned redirect (HTTP ${response.status}); redirects are not followed for SSRF safety.`,
      };
    }
    if (!response.ok) {
      return {
        channel: "webhook",
        status: "failed",
        detail: `Webhook responded with HTTP ${response.status}.`,
      };
    }
    return {
      channel: "webhook",
      status: "delivered",
      detail: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      channel: "webhook",
      status: "failed",
      detail: err instanceof Error ? err.message : "Webhook request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
};

const dispatchEmail = async (
  to: string,
  subject: string,
  body: string,
): Promise<DeviceAlertChannelDispatch> => {
  if (!to) {
    return {
      channel: "email",
      status: "skipped",
      detail: "Email recipient is not configured.",
    };
  }
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    return {
      channel: "email",
      status: "skipped",
      detail:
        "SMTP_HOST is not configured on the server; email delivery is unavailable.",
    };
  }
  // Email transport is intentionally not implemented yet — mark as skipped so
  // operators can see the configuration is incomplete.
  logger.info(
    { to, subject, body, host },
    "Email alert requested but no SMTP transport is wired up; skipping.",
  );
  return {
    channel: "email",
    status: "skipped",
    detail: "SMTP transport is not yet implemented in this build.",
  };
};

export const dispatchAlert = async (params: {
  deviceId: string;
  severity: DeviceAlertSeverity;
  minutesSinceData: number;
  thresholdMinutes: number;
  channels: NotificationChannelConfig;
  trigger: "scheduled" | "manual";
}) => {
  const { deviceId, severity, minutesSinceData, thresholdMinutes, channels } =
    params;
  const message =
    severity === "resolved"
      ? `Device ${deviceId} resumed reporting after ${minutesSinceData} min of silence.`
      : `Device ${deviceId} has been silent for ${minutesSinceData} min (threshold ${thresholdMinutes} min).`;

  const dispatch: DeviceAlertChannelDispatch[] = [];
  if (channels.inApp.enabled) dispatch.push(dispatchInApp());
  if (channels.webhook.enabled) {
    dispatch.push(
      await dispatchWebhook(channels.webhook.url, {
        source: "SolarNexus",
        trigger: params.trigger,
        deviceId,
        severity,
        minutesSinceData,
        thresholdMinutes,
        message,
        sentAt: new Date().toISOString(),
      }),
    );
  }
  if (channels.email.enabled) {
    dispatch.push(
      await dispatchEmail(
        channels.email.to,
        `SolarNexus alert: ${deviceId}`,
        message,
      ),
    );
  }

  const [event] = await db
    .insert(deviceAlertEventsTable)
    .values({
      deviceId,
      severity,
      minutesSinceData,
      thresholdMinutes,
      message,
      dispatch,
    })
    .returning();

  if (!event) throw new Error("Failed to record alert event");
  return event;
};

const getLatestPerDevice = async (): Promise<
  { deviceId: string; receivedAt: Date }[]
> => {
  const rows = await db
    .select({
      deviceId: modbusReadingsTable.deviceId,
      receivedAt: sql<Date>`max(${modbusReadingsTable.receivedAt})`,
    })
    .from(modbusReadingsTable)
    .groupBy(modbusReadingsTable.deviceId);
  return rows;
};

const getLatestEventPerDevice = async (
  deviceIds: string[],
): Promise<Map<string, { severity: DeviceAlertSeverity; createdAt: Date }>> => {
  const map = new Map<
    string,
    { severity: DeviceAlertSeverity; createdAt: Date }
  >();
  if (deviceIds.length === 0) return map;

  // Use Postgres DISTINCT ON to deterministically grab the most recent event
  // per device, scoped to only the devices being evaluated. This avoids the
  // bug where popular noisy devices could push out the latest event for a
  // quiet device when paginating from the global event log.
  const rows = await db.execute<{
    device_id: string;
    severity: DeviceAlertSeverity;
    created_at: string;
  }>(sql`
    select distinct on (device_id) device_id, severity, created_at
    from ${deviceAlertEventsTable}
    where ${inArray(deviceAlertEventsTable.deviceId, deviceIds)}
    order by device_id, created_at desc
  `);

  for (const row of rows.rows) {
    map.set(row.device_id, {
      severity: row.severity,
      createdAt: new Date(row.created_at),
    });
  }
  return map;
};

export const evaluateAndDispatch = async (now = new Date()) => {
  const settings = await getOrCreateNotificationSettings();
  if (!settings.enabled) return { evaluated: 0, dispatched: 0 };

  const channels = settings.channels;
  const anyChannelOn =
    channels.inApp.enabled ||
    channels.webhook.enabled ||
    channels.email.enabled;
  if (!anyChannelOn) return { evaluated: 0, dispatched: 0 };

  const latest = await getLatestPerDevice();
  if (latest.length === 0) return { evaluated: 0, dispatched: 0 };

  const deviceIds = latest.map((row) => row.deviceId);
  const lastEventByDevice = await getLatestEventPerDevice(deviceIds);

  const thresholdMs = settings.thresholdMinutes * 60_000;
  const cooldownMs = settings.cooldownMinutes * 60_000;
  let dispatched = 0;

  for (const { deviceId, receivedAt } of latest) {
    const ageMs = now.getTime() - new Date(receivedAt).getTime();
    const minutesSinceData = Math.round(ageMs / 60_000);
    const isStale = ageMs > thresholdMs;
    const lastEvent = lastEventByDevice.get(deviceId);
    const lastWasStale =
      lastEvent &&
      (lastEvent.severity === "warning" || lastEvent.severity === "fault");

    if (isStale) {
      const sinceLastEventMs = lastEvent
        ? now.getTime() - new Date(lastEvent.createdAt).getTime()
        : Infinity;
      if (lastWasStale && sinceLastEventMs < cooldownMs) continue;
      const severity: DeviceAlertSeverity =
        ageMs > thresholdMs * 3 ? "fault" : "warning";
      await dispatchAlert({
        deviceId,
        severity,
        minutesSinceData,
        thresholdMinutes: settings.thresholdMinutes,
        channels,
        trigger: "scheduled",
      });
      dispatched += 1;
    } else if (lastWasStale) {
      await dispatchAlert({
        deviceId,
        severity: "resolved",
        minutesSinceData,
        thresholdMinutes: settings.thresholdMinutes,
        channels,
        trigger: "scheduled",
      });
      dispatched += 1;
    }
  }

  return { evaluated: latest.length, dispatched };
};

let timer: NodeJS.Timeout | null = null;
let tickInFlight = false;

export const startStalenessMonitor = (intervalMs = 60_000) => {
  if (timer) return;
  const tick = async () => {
    // Single-flight guard: if a previous tick is still running (slow webhook
    // calls, DB stalls, etc.) skip this interval rather than overlapping it,
    // which could otherwise race the per-device cooldown lookup.
    if (tickInFlight) {
      logger.warn(
        "Staleness monitor tick skipped because the previous tick is still running.",
      );
      return;
    }
    tickInFlight = true;
    try {
      const result = await evaluateAndDispatch();
      if (result.dispatched > 0) {
        logger.info(
          { ...result },
          "Staleness monitor dispatched alert events.",
        );
      }
    } catch (err) {
      logger.error({ err }, "Staleness monitor tick failed");
    } finally {
      tickInFlight = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  // Run shortly after startup so users see results without waiting a full interval.
  setTimeout(tick, 5000).unref?.();
  timer.unref?.();
};

export const stopStalenessMonitor = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

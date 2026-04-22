import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell } from "lucide-react";
import {
  getGetAlertPreferencesQueryKey,
  getListAlertEventsQueryKey,
  listAlertEvents,
  useGetAlertPreferences,
  useListAlertEvents,
  useSendTestAlert,
  useUpdateAlertPreferences,
  useEvaluateAlertsNow,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SEVERITY_COLOR: Record<string, string> = {
  warning: "bg-amber-500 text-white",
  fault: "bg-red-600 text-white",
  resolved: "bg-emerald-600 text-white",
};

export function AlertsBell({ onOpen }: { onOpen: () => void }) {
  const { data } = useListAlertEvents(
    { limit: 25 },
    {
      query: {
        queryKey: getListAlertEventsQueryKey({ limit: 25 }),
        queryFn: ({ signal }) => listAlertEvents({ limit: 25 }, { signal }),
        refetchInterval: 30_000,
      },
    },
  );
  const events = data?.events ?? [];
  const unresolvedCount = useMemo(() => {
    const lastBySeverity = new Map<string, string>();
    for (const event of [...events].reverse()) {
      lastBySeverity.set(event.deviceId, event.severity);
    }
    let count = 0;
    for (const sev of lastBySeverity.values()) {
      if (sev === "warning" || sev === "fault") count += 1;
    }
    return count;
  }, [events]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Open alerts"
    >
      <Bell className="h-4 w-4" />
      {unresolvedCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
          {unresolvedCount}
        </span>
      )}
    </button>
  );
}

const ADMIN_TOKEN_KEY = "solarnexus.adminApiToken";

function AdminTokenField() {
  const [value, setValue] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [saved, setSaved] = useState(false);
  return (
    <div className="rounded-md border border-dashed bg-muted/40 p-3 text-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Admin API token
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] normal-case tracking-normal text-muted-foreground">
          stored only in this browser
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        In production deployments the alert preference, test, and evaluate
        endpoints require <code>ADMIN_API_TOKEN</code>. Paste the same value
        here so this browser can authenticate. The token is kept in
        localStorage and is never bundled into the app.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder="Paste admin token"
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            try {
              if (value.trim()) {
                window.localStorage.setItem(ADMIN_TOKEN_KEY, value.trim());
              } else {
                window.localStorage.removeItem(ADMIN_TOKEN_KEY);
              }
              setSaved(true);
            } catch {
              setSaved(false);
            }
          }}
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            try {
              window.localStorage.removeItem(ADMIN_TOKEN_KEY);
            } catch {
              /* ignore */
            }
            setValue("");
            setSaved(true);
          }}
        >
          Clear
        </Button>
      </div>
      {saved ? (
        <p className="mt-2 text-xs text-emerald-600">
          Saved. The token will be sent with admin requests from this browser.
        </p>
      ) : null}
    </div>
  );
}

export function AlertsPanel() {
  const queryClient = useQueryClient();
  const prefsQuery = useGetAlertPreferences();
  const eventsQuery = useListAlertEvents(
    { limit: 50 },
    {
      query: {
        queryKey: getListAlertEventsQueryKey({ limit: 50 }),
        queryFn: ({ signal }) => listAlertEvents({ limit: 50 }, { signal }),
        refetchInterval: 30_000,
      },
    },
  );
  const updateMutation = useUpdateAlertPreferences();
  const testMutation = useSendTestAlert();
  const evaluateMutation = useEvaluateAlertsNow();

  const prefs = prefsQuery.data?.preferences;

  type FormState = {
    enabled: boolean;
    thresholdMinutes: number;
    cooldownMinutes: number;
    inAppEnabled: boolean;
    webhookEnabled: boolean;
    webhookUrl: string;
    emailEnabled: boolean;
    emailTo: string;
  };

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (prefs && !form) {
      setForm({
        enabled: prefs.enabled,
        thresholdMinutes: prefs.thresholdMinutes,
        cooldownMinutes: prefs.cooldownMinutes,
        inAppEnabled: prefs.channels.inApp.enabled,
        webhookEnabled: prefs.channels.webhook.enabled,
        webhookUrl: prefs.channels.webhook.url ?? "",
        emailEnabled: prefs.channels.email.enabled,
        emailTo: prefs.channels.email.to ?? "",
      });
    }
  }, [prefs, form]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: getGetAlertPreferencesQueryKey(),
    });
    await queryClient.invalidateQueries({
      queryKey: getListAlertEventsQueryKey({ limit: 50 }),
    });
    await queryClient.invalidateQueries({
      queryKey: getListAlertEventsQueryKey({ limit: 25 }),
    });
  };

  const onSave = async () => {
    if (!form) return;
    await updateMutation.mutateAsync({
      data: {
        enabled: form.enabled,
        thresholdMinutes: form.thresholdMinutes,
        cooldownMinutes: form.cooldownMinutes,
        channels: {
          inApp: { enabled: form.inAppEnabled },
          webhook: { enabled: form.webhookEnabled, url: form.webhookUrl },
          email: { enabled: form.emailEnabled, to: form.emailTo },
        },
      },
    });
    await invalidate();
  };

  const onSendTest = async () => {
    await testMutation.mutateAsync({ data: { deviceId: "test-device" } });
    await invalidate();
  };

  const onEvaluate = async () => {
    await evaluateMutation.mutateAsync();
    await invalidate();
  };

  if (prefsQuery.isLoading || !form) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading alert preferences…
        </CardContent>
      </Card>
    );
  }

  if (prefsQuery.isError) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-600">
          Could not load alert preferences. The API may be unavailable.
        </CardContent>
      </Card>
    );
  }

  const events = eventsQuery.data?.events ?? [];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Notification preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) =>
                setForm({ ...form, enabled: e.target.checked })
              }
              className="h-4 w-4"
            />
            <span>
              Send a notification when a device misses its staleness threshold.
            </span>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Threshold (minutes)
              </label>
              <input
                type="number"
                min={1}
                max={1440}
                value={form.thresholdMinutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    thresholdMinutes: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                A device is considered silent after this many minutes without a
                payload.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Repeat cooldown (minutes)
              </label>
              <input
                type="number"
                min={1}
                max={1440}
                value={form.cooldownMinutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    cooldownMinutes: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Wait at least this long before sending another alert for the
                same device while it is still silent.
              </p>
            </div>
          </div>

          <AdminTokenField />

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Channels
            </div>

            <label className="flex items-center gap-3 rounded-md border bg-background p-3 text-sm">
              <input
                type="checkbox"
                checked={form.inAppEnabled}
                onChange={(e) =>
                  setForm({ ...form, inAppEnabled: e.target.checked })
                }
                className="h-4 w-4"
              />
              <div>
                <div className="font-semibold">In-app feed</div>
                <div className="text-xs text-muted-foreground">
                  Always recorded in the dashboard alert feed and bell badge.
                </div>
              </div>
            </label>

            <div className="rounded-md border bg-background p-3 text-sm">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.webhookEnabled}
                  onChange={(e) =>
                    setForm({ ...form, webhookEnabled: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                <div>
                  <div className="font-semibold">Webhook</div>
                  <div className="text-xs text-muted-foreground">
                    POST a JSON alert to any URL — works with Slack, Microsoft
                    Teams, Discord, or your own service.
                  </div>
                </div>
              </label>
              <input
                type="url"
                placeholder="https://hooks.slack.com/services/…"
                value={form.webhookUrl}
                onChange={(e) =>
                  setForm({ ...form, webhookUrl: e.target.value })
                }
                disabled={!form.webhookEnabled}
                className="mt-3 h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50"
              />
            </div>

            <div className="rounded-md border bg-background p-3 text-sm">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.emailEnabled}
                  onChange={(e) =>
                    setForm({ ...form, emailEnabled: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    Email
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                      Preview only
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Email delivery is not yet active. SMTP transport ships in a
                    follow-up; until then dispatch attempts are recorded as
                    &quot;skipped&quot; in the event log so you can confirm the
                    pipeline. Use the webhook channel for outbound notifications
                    today.
                  </div>
                </div>
              </label>
              <input
                type="email"
                placeholder="ops@example.com"
                value={form.emailTo}
                onChange={(e) => setForm({ ...form, emailTo: e.target.value })}
                disabled={!form.emailEnabled}
                className="mt-3 h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={onSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save preferences"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onSendTest}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? "Sending…" : "Send test alert"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onEvaluate}
              disabled={evaluateMutation.isPending}
            >
              {evaluateMutation.isPending
                ? "Evaluating…"
                : "Evaluate devices now"}
            </Button>
            {updateMutation.isSuccess && (
              <span className="text-xs text-emerald-600">Saved.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent alert events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No alerts yet. When a device misses its threshold the event will
              appear here.
            </div>
          ) : (
            <ul className="divide-y">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <Badge className={SEVERITY_COLOR[event.severity] ?? ""}>
                      {event.severity}
                    </Badge>
                    <div>
                      <div className="text-sm font-semibold">
                        {event.deviceId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {event.message}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-1 text-xs text-muted-foreground md:items-end">
                    <span>
                      {formatDistanceToNow(new Date(event.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {event.dispatch.map((d, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className={
                            d.status === "delivered"
                              ? "border-emerald-500 text-emerald-700"
                              : d.status === "failed"
                              ? "border-red-500 text-red-600"
                              : ""
                          }
                        >
                          {d.channel}: {d.status}
                        </Badge>
                      ))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

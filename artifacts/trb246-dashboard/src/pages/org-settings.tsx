import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getStoredUser } from "@/lib/auth";
import {
  saasApi,
  type Member,
  type PendingInvite,
  type ApiKeyRow,
  type CreatedApiKey,
  type AuditEvent,
  type Usage,
} from "@/lib/saas-api";
import {
  Loader2,
  Copy,
  Trash2,
  Plus,
  Users,
  Mail,
  KeyRound,
  ScrollText,
  Gauge,
} from "lucide-react";

const TAB_KEYS = ["members", "invites", "api-keys", "audit", "usage"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const ROLE_OPTIONS = ["viewer", "operator", "admin", "owner"] as const;

function roleAtLeast(role: string | undefined, min: string): boolean {
  const order = ["viewer", "operator", "admin", "owner"];
  return order.indexOf(role ?? "") >= order.indexOf(min);
}

export default function OrgSettingsPage() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const user = getStoredUser();
  const memberships = (user as unknown as { memberships?: Array<{ orgSlug: string; orgName: string; role: string }> })?.memberships ?? [];
  const currentMembership = memberships[0];
  const slug = currentMembership?.orgSlug ?? "default";
  const role = currentMembership?.role ?? "viewer";

  const tab = useMemo<TabKey>(() => {
    const seg = location.replace(/^\/settings\/?/, "").split("/")[0] ?? "";
    return (TAB_KEYS as readonly string[]).includes(seg)
      ? (seg as TabKey)
      : "members";
  }, [location]);

  if (!user) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Please sign in to view organization settings.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Organization settings
        </h1>
        <p className="text-sm text-muted-foreground">
          {currentMembership?.orgName ?? "Default Organization"} ·{" "}
          <Badge variant="outline" className="ml-1 capitalize">
            you are {role}
          </Badge>
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => navigate(`/settings/${v}`)}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="members">
            <Users className="mr-2 h-4 w-4" /> Members
          </TabsTrigger>
          <TabsTrigger value="invites" disabled={!roleAtLeast(role, "admin")}>
            <Mail className="mr-2 h-4 w-4" /> Invitations
          </TabsTrigger>
          <TabsTrigger value="api-keys" disabled={!roleAtLeast(role, "admin")}>
            <KeyRound className="mr-2 h-4 w-4" /> API keys
          </TabsTrigger>
          <TabsTrigger value="audit" disabled={!roleAtLeast(role, "admin")}>
            <ScrollText className="mr-2 h-4 w-4" /> Audit log
          </TabsTrigger>
          <TabsTrigger value="usage">
            <Gauge className="mr-2 h-4 w-4" /> Usage
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <MembersPanel slug={slug} role={role} toast={toast} />
        </TabsContent>
        <TabsContent value="invites" className="mt-4">
          <InvitesPanel slug={slug} role={role} toast={toast} />
        </TabsContent>
        <TabsContent value="api-keys" className="mt-4">
          <ApiKeysPanel slug={slug} toast={toast} />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditPanel slug={slug} toast={toast} />
        </TabsContent>
        <TabsContent value="usage" className="mt-4">
          <UsagePanel slug={slug} toast={toast} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type ToastFn = ReturnType<typeof useToast>["toast"];

function MembersPanel({
  slug,
  role,
  toast,
}: {
  slug: string;
  role: string;
  toast: ToastFn;
}) {
  const [rows, setRows] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = () =>
    saasApi
      .listMembers(slug)
      .then((d) => setRows(d.members))
      .catch((e) => toast({ title: "Failed to load", description: String(e) }));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function changeRole(userId: number, newRole: string) {
    setBusy(userId);
    try {
      await saasApi.setMemberRole(slug, userId, newRole);
      toast({ title: "Role updated" });
      await load();
    } catch (e) {
      toast({ title: "Update failed", description: String(e) });
    } finally {
      setBusy(null);
    }
  }
  async function remove(userId: number) {
    if (!confirm("Remove this member from the organization?")) return;
    setBusy(userId);
    try {
      await saasApi.removeMember(slug, userId);
      toast({ title: "Member removed" });
      await load();
    } catch (e) {
      toast({ title: "Remove failed", description: String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent>
        {!rows ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <div className="divide-y rounded-md border">
            {rows.map((m) => (
              <div
                key={m.userId}
                className="flex items-center gap-3 p-3"
                data-testid={`row-member-${m.userId}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m.name || m.email}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {m.email}
                  </div>
                </div>
                {roleAtLeast(role, "admin") ? (
                  <Select
                    value={m.role}
                    onValueChange={(v) => changeRole(m.userId, v)}
                    disabled={busy === m.userId}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className="capitalize">
                    {m.role}
                  </Badge>
                )}
                {roleAtLeast(role, "admin") && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(m.userId)}
                    disabled={busy === m.userId}
                    data-testid={`button-remove-${m.userId}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InvitesPanel({
  slug,
  role,
  toast,
}: {
  slug: string;
  role: string;
  toast: ToastFn;
}) {
  const [rows, setRows] = useState<PendingInvite[] | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("viewer");
  const [submitting, setSubmitting] = useState(false);

  const load = () =>
    saasApi
      .listInvites(slug)
      .then((d) => setRows(d.invitations))
      .catch((e) => toast({ title: "Failed to load", description: String(e) }));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await saasApi.createInvite(slug, email.trim(), inviteRole);
      toast({
        title: "Invitation sent",
        description: res.mailDispatched
          ? "An email has been sent to the invitee."
          : "SMTP is not configured — copy the link from the server log.",
      });
      setEmail("");
      await load();
    } catch (e) {
      toast({ title: "Invite failed", description: String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: number) {
    try {
      await saasApi.revokeInvite(slug, id);
      toast({ title: "Invitation revoked" });
      await load();
    } catch (e) {
      toast({ title: "Revoke failed", description: String(e) });
    }
  }

  return (
    <div className="space-y-4">
      {roleAtLeast(role, "admin") && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[16rem] space-y-1">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-invite-email"
                />
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.filter(
                      (r) => r !== "owner" || role === "owner",
                    ).map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={submitting || !email.trim()} data-testid="button-invite-submit">
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" /> Send invite
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
        </CardHeader>
        <CardContent>
          {!rows ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No pending invitations.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {rows.map((i) => (
                <div key={i.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      Expires {new Date(i.expiresAt).toLocaleString()}
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {i.role}
                  </Badge>
                  {roleAtLeast(role, "admin") && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => revoke(i.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ApiKeysPanel({ slug, toast }: { slug: string; toast: ToastFn }) {
  const [rows, setRows] = useState<ApiKeyRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const load = () =>
    saasApi
      .listApiKeys(slug)
      .then((d) => setRows(d.apiKeys))
      .catch((e) => toast({ title: "Failed to load", description: String(e) }));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await saasApi.createApiKey(slug, label.trim());
      setCreated(res.apiKey);
      setLabel("");
      await load();
    } catch (e) {
      toast({ title: "Create failed", description: String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: number) {
    if (!confirm("Revoke this API key? Devices using it will stop working.")) return;
    try {
      await saasApi.revokeApiKey(slug, id);
      toast({ title: "Key revoked" });
      await load();
    } catch (e) {
      toast({ title: "Revoke failed", description: String(e) });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create a new API key</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[16rem] space-y-1">
              <Label htmlFor="key-label">Label</Label>
              <Input
                id="key-label"
                placeholder="e.g. site-A trb246"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                data-testid="input-key-label"
              />
            </div>
            <Button type="submit" disabled={submitting || !label.trim()} data-testid="button-create-key">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" /> Create key
                </>
              )}
            </Button>
          </form>
          {created && (
            <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
              <div className="font-medium">
                Copy this key now — it won't be shown again.
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background px-2 py-1 font-mono text-xs">
                  {created.secret}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(created.secret);
                    toast({ title: "Copied to clipboard" });
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" onClick={() => setCreated(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing keys</CardTitle>
        </CardHeader>
        <CardContent>
          {!rows ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No API keys yet.</div>
          ) : (
            <div className="divide-y rounded-md border">
              {rows.map((k) => (
                <div key={k.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{k.label || "(unlabeled)"}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {k.prefix}…
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {k.lastUsedAt
                      ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
                      : "never used"}
                  </div>
                  {k.revokedAt ? (
                    <Badge variant="secondary">revoked</Badge>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => revoke(k.id)}
                      data-testid={`button-revoke-key-${k.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AuditPanel({ slug, toast }: { slug: string; toast: ToastFn }) {
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  useEffect(() => {
    saasApi
      .listAudit(slug)
      .then((d) => setRows(d.events))
      .catch((e) => toast({ title: "Failed to load", description: String(e) }));
  }, [slug, toast]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
      </CardHeader>
      <CardContent>
        {!rows ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No events yet.</div>
        ) : (
          <div className="divide-y rounded-md border">
            {rows.map((e) => (
              <div key={e.id} className="grid grid-cols-12 gap-2 p-3 text-sm">
                <div className="col-span-3 text-xs text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString()}
                </div>
                <div className="col-span-3 truncate">
                  {e.actor ? `${e.actor.name || e.actor.email}` : "system"}
                </div>
                <div className="col-span-3 font-mono text-xs">{e.action}</div>
                <div className="col-span-3 truncate text-xs text-muted-foreground">
                  {e.targetType}
                  {e.targetId ? ` #${e.targetId}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UsagePanel({ slug, toast }: { slug: string; toast: ToastFn }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    saasApi
      .getUsage(slug)
      .then(setUsage)
      .catch((e) => toast({ title: "Failed to load", description: String(e) }));
  }, [slug, toast]);

  if (!usage) return <Loader2 className="h-4 w-4 animate-spin" />;
  const cells: Array<{ label: string; used: number; max: number }> = [
    { label: "Members", used: usage.members, max: usage.limits.maxMembers },
    { label: "Active API keys", used: usage.apiKeys, max: usage.limits.maxApiKeys },
    {
      label: "Readings this month",
      used: usage.readingsThisMonth,
      max: usage.limits.maxReadingsPerMonth,
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cells.map((c) => {
        const pct = Math.min(100, Math.round((c.used / Math.max(1, c.max)) * 100));
        return (
          <Card key={c.label}>
            <CardHeader>
              <CardTitle className="text-base">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {c.used.toLocaleString()}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / {c.max.toLocaleString()}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className={`h-full ${
                    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

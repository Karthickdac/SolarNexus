import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  saasApi,
  type ApiKeyRow,
  type CreatedApiKey,
  type DecoderMapView,
  type RegisterDefinition,
  type RegisterMap,
} from "@/lib/saas-api";
import {
  Loader2,
  Copy,
  Trash2,
  Plus,
  RotateCcw,
  Save,
} from "lucide-react";

type ToastFn = ReturnType<typeof useToast>["toast"];

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
const INGEST_PATH = `${BASE}/api/modbus/readings`;

function ingestUrl(): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://your-host";
  return `${origin}${INGEST_PATH}`;
}

function CopyButton({
  value,
  toast,
  label = "Copied to clipboard",
}: {
  value: string;
  toast: ToastFn;
  label?: string;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast({ title: label });
      }}
      aria-label="Copy"
    >
      <Copy className="h-4 w-4" />
    </Button>
  );
}

export function DeviceConnectionPanel({
  slug,
  isSuperAdmin,
  toast,
}: {
  slug: string;
  isSuperAdmin: boolean;
  toast: ToastFn;
}) {
  return (
    <div className="space-y-4">
      <ConnectionCard toast={toast} />
      <DeviceKeysCard slug={slug} toast={toast} />
      <SetupStepsCard />
      {isSuperAdmin && <DecodeMapCard toast={toast} />}
    </div>
  );
}

function ConnectionCard({ toast }: { toast: ToastFn }) {
  const url = ingestUrl();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingest endpoint</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>POST URL</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
              {url}
            </code>
            <CopyButton value={url} toast={toast} />
          </div>
          <p className="text-xs text-muted-foreground">
            Configure the TRB246 Data to Server output with HTTP method{" "}
            <span className="font-mono">POST</span> and content type{" "}
            <span className="font-mono">application/json</span>.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Authentication</Label>
          <p className="text-xs text-muted-foreground">
            The device must present a device key. The TRB246 cannot add custom
            request headers, so use the query-parameter form below. Generate a
            key in the Device keys section.
          </p>
          <div className="space-y-1">
            <div className="text-xs font-medium">
              Recommended — query parameter
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
                {`${url}?token=YOUR_DEVICE_KEY`}
              </code>
              <CopyButton
                value={`${url}?token=YOUR_DEVICE_KEY`}
                toast={toast}
              />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium">
              Alternative — request header (if your client supports it)
            </div>
            <code className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
              x-device-key: YOUR_DEVICE_KEY
            </code>
            <code className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
              Authorization: Bearer YOUR_DEVICE_KEY
            </code>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DeviceKeysCard({ slug, toast }: { slug: string; toast: ToastFn }) {
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
    if (!confirm("Revoke this device key? The device using it will stop sending data."))
      return;
    try {
      await saasApi.revokeApiKey(slug, id);
      toast({ title: "Key revoked" });
      await load();
    } catch (e) {
      toast({ title: "Revoke failed", description: String(e) });
    }
  }

  const tokenizedUrl = created
    ? `${ingestUrl()}?token=${created.secret}`
    : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Device keys</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[16rem] space-y-1">
            <Label htmlFor="device-key-label">Label</Label>
            <Input
              id="device-key-label"
              placeholder="e.g. site-A trb246"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="input-device-key-label"
            />
          </div>
          <Button
            type="submit"
            disabled={submitting || !label.trim()}
            data-testid="button-create-device-key"
          >
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
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
            <div className="font-medium">
              Copy this key now — it won't be shown again.
            </div>
            <div className="mt-2 space-y-1">
              <div className="text-xs text-muted-foreground">Device key</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background px-2 py-1 font-mono text-xs">
                  {created.secret}
                </code>
                <CopyButton value={created.secret} toast={toast} />
              </div>
            </div>
            <div className="mt-2 space-y-1">
              <div className="text-xs text-muted-foreground">
                Ready-to-paste ingest URL
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background px-2 py-1 font-mono text-xs">
                  {tokenizedUrl}
                </code>
                <CopyButton value={tokenizedUrl} toast={toast} />
              </div>
            </div>
            <div className="mt-2">
              <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {!rows ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No device keys yet.
          </div>
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
                    data-testid={`button-revoke-device-key-${k.id}`}
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

const SETUP_STEPS = [
  "On the TRB246, open Services → Data to Server and add a new collection.",
  "Set the data source to Modbus and select the registers you poll from the inverter.",
  "Add an HTTP output: method POST, the ingest URL above, content type application/json.",
  "Append ?token=YOUR_DEVICE_KEY to the URL (the device cannot send custom headers).",
  "Set your polling/send period, save, and confirm readings appear on the Overview page.",
];

function SetupStepsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>TRB246 setup steps</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          {SETUP_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

type EditableRow = {
  address: string;
  name: string;
  unit: string;
  kind: "number" | "boolean";
  scale: string;
  words: string;
  wordOrder: "lohi" | "hilo";
  labels?: Record<string, string>;
};

function mapToRows(map: RegisterMap): EditableRow[] {
  return Object.entries(map)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([address, def]) => ({
      address,
      name: def.name,
      unit: def.unit ?? "",
      kind: def.kind,
      scale: def.scale === undefined ? "" : String(def.scale),
      words: def.words === undefined ? "" : String(def.words),
      wordOrder: def.wordOrder ?? "lohi",
      labels: def.labels,
    }));
}

function rowsToMap(rows: EditableRow[]): RegisterMap {
  const map: RegisterMap = {};
  for (const row of rows) {
    const address = row.address.trim();
    const def: RegisterDefinition = {
      name: row.name.trim(),
      unit: row.unit.trim() === "" ? null : row.unit.trim(),
      kind: row.kind,
    };
    if (row.scale.trim() !== "") def.scale = Number(row.scale);
    if (row.words.trim() !== "") def.words = Number(row.words);
    if (row.wordOrder !== "lohi") def.wordOrder = row.wordOrder;
    if (row.labels) def.labels = row.labels;
    map[address] = def;
  }
  return map;
}

function DecodeMapCard({ toast }: { toast: ToastFn }) {
  const [view, setView] = useState<DecoderMapView | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  function apply(v: DecoderMapView) {
    setView(v);
    setRows(mapToRows(v.registerMap));
  }

  useEffect(() => {
    saasApi
      .getDecoderMap()
      .then(apply)
      .catch((e) =>
        toast({ title: "Failed to load decode map", description: String(e) }),
      );
  }, [toast]);

  function updateRow(index: number, patch: Partial<EditableRow>) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }
  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }
  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        address: "",
        name: "",
        unit: "",
        kind: "number",
        scale: "",
        words: "",
        wordOrder: "lohi",
      },
    ]);
  }

  const duplicateAddress = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      const a = r.address.trim();
      if (a && seen.has(a)) return a;
      if (a) seen.add(a);
    }
    return null;
  }, [rows]);

  async function save() {
    if (duplicateAddress) {
      toast({
        title: "Duplicate address",
        description: `Register ${duplicateAddress} is listed more than once.`,
      });
      return;
    }
    setSaving(true);
    try {
      const updated = await saasApi.saveDecoderMap(rowsToMap(rows));
      apply(updated);
      toast({ title: "Decode map saved" });
    } catch (e) {
      toast({ title: "Save failed", description: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (
      !confirm(
        "Reset the decode map to the built-in default? Your custom mappings will be discarded.",
      )
    )
      return;
    setResetting(true);
    try {
      const updated = await saasApi.resetDecoderMap();
      apply(updated);
      toast({ title: "Decode map reset to default" });
    } catch (e) {
      toast({ title: "Reset failed", description: String(e) });
    } finally {
      setResetting(false);
    }
  }

  if (!view) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Register decode map</CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-4 w-4 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Register decode map</CardTitle>
          <Badge variant={view.isCustom ? "default" : "outline"}>
            {view.isCustom ? "custom" : "default"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Maps each Modbus register address to a named metric. Changes apply to
          newly ingested readings immediately. <span className="font-mono">scale</span>{" "}
          multiplies the raw value; <span className="font-mono">words</span> is 1
          (16-bit) or 2 (32-bit); word order applies to 32-bit values.
        </p>

        <div className="overflow-x-auto">
          <div className="min-w-[760px] space-y-2">
            <div className="grid grid-cols-[90px_1fr_70px_110px_80px_70px_110px_40px] gap-2 px-1 text-xs font-medium text-muted-foreground">
              <div>Address</div>
              <div>Name</div>
              <div>Unit</div>
              <div>Kind</div>
              <div>Scale</div>
              <div>Words</div>
              <div>Word order</div>
              <div />
            </div>
            {rows.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-[90px_1fr_70px_110px_80px_70px_110px_40px] items-center gap-2"
                data-testid={`row-register-${i}`}
              >
                <Input
                  value={row.address}
                  inputMode="numeric"
                  placeholder="5019"
                  onChange={(e) => updateRow(i, { address: e.target.value })}
                />
                <Input
                  value={row.name}
                  placeholder="voltage_a"
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                />
                <Input
                  value={row.unit}
                  placeholder="V"
                  onChange={(e) => updateRow(i, { unit: e.target.value })}
                />
                <Select
                  value={row.kind}
                  onValueChange={(v) =>
                    updateRow(i, { kind: v as "number" | "boolean" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="boolean">boolean</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={row.scale}
                  inputMode="decimal"
                  placeholder="0.1"
                  disabled={row.kind === "boolean"}
                  onChange={(e) => updateRow(i, { scale: e.target.value })}
                />
                <Input
                  value={row.words}
                  inputMode="numeric"
                  placeholder="1"
                  disabled={row.kind === "boolean"}
                  onChange={(e) => updateRow(i, { words: e.target.value })}
                />
                <Select
                  value={row.wordOrder}
                  disabled={row.kind === "boolean"}
                  onValueChange={(v) =>
                    updateRow(i, { wordOrder: v as "lohi" | "hilo" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lohi">lohi</SelectItem>
                    <SelectItem value="hilo">hilo</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeRow(i)}
                  aria-label="Remove register"
                  data-testid={`button-remove-register-${i}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={addRow}>
            <Plus className="mr-2 h-4 w-4" /> Add register
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={saving}
            data-testid="button-save-decode-map"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" /> Save map
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={reset}
            disabled={resetting || !view.isCustom}
          >
            {resetting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <RotateCcw className="mr-2 h-4 w-4" /> Reset to default
              </>
            )}
          </Button>
        </div>
        {view.updatedAt && (
          <p className="text-xs text-muted-foreground">
            Last updated {new Date(view.updatedAt).toLocaleString()}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

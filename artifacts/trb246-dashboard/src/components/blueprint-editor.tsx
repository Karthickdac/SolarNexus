import { useRef, useState } from "react";
import { Pencil, Plus, Trash2, Upload, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  BlueprintInverter,
  BlueprintString,
  SiteBlueprint,
} from "../config/site-blueprint";

type Props = {
  blueprint: SiteBlueprint;
  setBlueprint: (next: SiteBlueprint) => void;
  resetBlueprint: () => void;
};

type StringDraft = BlueprintString;
type InverterDraft = BlueprintInverter;

function emptyString(blueprint: SiteBlueprint): StringDraft {
  const id = `str-${Date.now().toString(36)}`;
  const inverter = blueprint.inverters[0];
  return {
    id,
    name: `String ${blueprint.strings.length + 1}`,
    inverterId: inverter?.id ?? "",
    deviceId: inverter?.deviceId ?? "TRB246-GATEWAY-01",
    mppt: "MPPT-1",
    dcCapacityKw: 28,
    expectedPowerW: 12,
    x: 20,
    y: 30,
  };
}

function emptyInverter(blueprint: SiteBlueprint): InverterDraft {
  const id = `inv-${Date.now().toString(36)}`;
  return {
    id,
    name: `Inverter ${blueprint.inverters.length + 1}`,
    block: "Block",
    deviceId: "TRB246-GATEWAY-01",
    x: 60,
    y: 40,
  };
}

function NumberInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

export function BlueprintEditor({ blueprint, setBlueprint, resetBlueprint }: Props) {
  const [stringDraft, setStringDraft] = useState<StringDraft | null>(null);
  const [inverterDraft, setInverterDraft] = useState<InverterDraft | null>(null);
  const [isCreatingString, setIsCreatingString] = useState(false);
  const [isCreatingInverter, setIsCreatingInverter] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function updateMeta<K extends keyof SiteBlueprint>(key: K, value: SiteBlueprint[K]) {
    setBlueprint({ ...blueprint, [key]: value });
  }

  function saveString(draft: StringDraft) {
    const exists = blueprint.strings.some((item) => item.id === draft.id);
    const nextStrings = exists
      ? blueprint.strings.map((item) => (item.id === draft.id ? draft : item))
      : [...blueprint.strings, draft];
    setBlueprint({ ...blueprint, strings: nextStrings });
    setStringDraft(null);
    setIsCreatingString(false);
  }

  function deleteString(id: string) {
    setBlueprint({ ...blueprint, strings: blueprint.strings.filter((item) => item.id !== id) });
  }

  function saveInverter(draft: InverterDraft) {
    const exists = blueprint.inverters.some((item) => item.id === draft.id);
    const nextInverters = exists
      ? blueprint.inverters.map((item) => (item.id === draft.id ? draft : item))
      : [...blueprint.inverters, draft];
    setBlueprint({ ...blueprint, inverters: nextInverters });
    setInverterDraft(null);
    setIsCreatingInverter(false);
  }

  function deleteInverter(id: string) {
    setBlueprint({
      ...blueprint,
      inverters: blueprint.inverters.filter((item) => item.id !== id),
      strings: blueprint.strings.filter((item) => item.inverterId !== id),
    });
  }

  function exportBlueprint() {
    const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${blueprint.siteName.replace(/\s+/g, "-").toLowerCase()}-blueprint.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importBlueprint(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as SiteBlueprint;
        if (!parsed.strings || !parsed.inverters || !parsed.zones) throw new Error("Invalid blueprint");
        setBlueprint(parsed);
      } catch (error) {
        window.alert(`Could not import blueprint: ${(error as Error).message}`);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Site Settings</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportBlueprint}><Download className="mr-1 h-4 w-4" /> Export JSON</Button>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><Upload className="mr-1 h-4 w-4" /> Import JSON</Button>
            <Button variant="outline" size="sm" onClick={resetBlueprint}><RotateCcw className="mr-1 h-4 w-4" /> Reset</Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importBlueprint(file);
                event.target.value = "";
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Site Name</label>
            <Input value={blueprint.siteName} onChange={(event) => updateMeta("siteName", event.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Client Name</label>
            <Input value={blueprint.clientName} onChange={(event) => updateMeta("clientName", event.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Capacity (MW)</label>
            <NumberInput value={blueprint.capacityMw} onChange={(next) => updateMeta("capacityMw", next)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Location</label>
            <Input value={blueprint.location} onChange={(event) => updateMeta("location", event.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Inverters ({blueprint.inverters.length})</CardTitle>
          <Button size="sm" onClick={() => { setInverterDraft(emptyInverter(blueprint)); setIsCreatingInverter(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Add Inverter
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {blueprint.inverters.map((inverter) => (
            <div key={inverter.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{inverter.name}</div>
                  <div className="text-xs text-muted-foreground">{inverter.block} • {inverter.deviceId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">x: {inverter.x}% • y: {inverter.y}%</div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => { setInverterDraft(inverter); setIsCreatingInverter(false); }}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteInverter(inverter.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Strings ({blueprint.strings.length})</CardTitle>
          <Button size="sm" onClick={() => { setStringDraft(emptyString(blueprint)); setIsCreatingString(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Add String
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {blueprint.strings.map((string) => (
            <div key={string.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{string.name}</div>
                  <div className="text-xs text-muted-foreground">{string.deviceId} • {string.mppt} • {string.expectedPowerW} W expected</div>
                  <div className="mt-1 text-xs text-muted-foreground">Inverter: {string.inverterId} • x: {string.x}% • y: {string.y}%</div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => { setStringDraft(string); setIsCreatingString(false); }}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteString(string.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={stringDraft !== null} onOpenChange={(open) => { if (!open) { setStringDraft(null); setIsCreatingString(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isCreatingString ? "Add String" : "Edit String"}</DialogTitle>
          </DialogHeader>
          {stringDraft && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><Input value={stringDraft.name} onChange={(event) => setStringDraft({ ...stringDraft, name: event.target.value })} /></Field>
              <Field label="Device ID"><Input value={stringDraft.deviceId} onChange={(event) => setStringDraft({ ...stringDraft, deviceId: event.target.value })} /></Field>
              <Field label="Inverter">
                <select className="h-9 rounded-md border bg-background px-2" value={stringDraft.inverterId} onChange={(event) => setStringDraft({ ...stringDraft, inverterId: event.target.value })}>
                  {blueprint.inverters.map((inverter) => (
                    <option key={inverter.id} value={inverter.id}>{inverter.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="MPPT"><Input value={stringDraft.mppt} onChange={(event) => setStringDraft({ ...stringDraft, mppt: event.target.value })} /></Field>
              <Field label="Expected Power (W)"><NumberInput value={stringDraft.expectedPowerW} onChange={(next) => setStringDraft({ ...stringDraft, expectedPowerW: next })} /></Field>
              <Field label="DC Capacity (kW)"><NumberInput value={stringDraft.dcCapacityKw} onChange={(next) => setStringDraft({ ...stringDraft, dcCapacityKw: next })} /></Field>
              <Field label="X position (%)"><NumberInput value={stringDraft.x} onChange={(next) => setStringDraft({ ...stringDraft, x: next })} /></Field>
              <Field label="Y position (%)"><NumberInput value={stringDraft.y} onChange={(next) => setStringDraft({ ...stringDraft, y: next })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setStringDraft(null); setIsCreatingString(false); }}>Cancel</Button>
            <Button onClick={() => stringDraft && saveString(stringDraft)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inverterDraft !== null} onOpenChange={(open) => { if (!open) { setInverterDraft(null); setIsCreatingInverter(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isCreatingInverter ? "Add Inverter" : "Edit Inverter"}</DialogTitle>
          </DialogHeader>
          {inverterDraft && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><Input value={inverterDraft.name} onChange={(event) => setInverterDraft({ ...inverterDraft, name: event.target.value })} /></Field>
              <Field label="Block"><Input value={inverterDraft.block} onChange={(event) => setInverterDraft({ ...inverterDraft, block: event.target.value })} /></Field>
              <Field label="Device ID"><Input value={inverterDraft.deviceId} onChange={(event) => setInverterDraft({ ...inverterDraft, deviceId: event.target.value })} /></Field>
              <Field label="X position (%)"><NumberInput value={inverterDraft.x} onChange={(next) => setInverterDraft({ ...inverterDraft, x: next })} /></Field>
              <Field label="Y position (%)"><NumberInput value={inverterDraft.y} onChange={(next) => setInverterDraft({ ...inverterDraft, y: next })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setInverterDraft(null); setIsCreatingInverter(false); }}>Cancel</Button>
            <Button onClick={() => inverterDraft && saveInverter(inverterDraft)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { CSVLink } from "react-csv";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  Calculator,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  Gauge,
  LayoutDashboard,
  Lock,
  LogOut,
  Moon,
  Network,
  Power,
  Printer,
  Settings,
  Sun,
  Thermometer,
  TrendingUp,
  Users as UsersIcon,
  Workflow,
  Zap,
} from "lucide-react";
import { clearSession, getStoredUser } from "@/lib/auth";
import OrgSettingsPage from "./org-settings";
import { format, formatDistanceToNow } from "date-fns";
import {
  deleteSiteStalenessThreshold,
  getListDeviceSiteAssignmentsQueryKey,
  getListModbusReadingsQueryKey,
  getListSiteStalenessThresholdsQueryKey,
  replaceSiteDeviceAssignments,
  upsertSiteStalenessThreshold,
  useListModbusReadings,
  useListSiteStalenessThresholds,
} from "@workspace/api-client-react";
import type {
  ModbusDecodedRegister,
  ModbusReading,
  ModbusReadingRawPayload,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { KPICard } from "../components/kpi-card";
import { SplitRefreshButton } from "../components/split-refresh-button";
import { DataTable } from "../components/data-table";
import type { BlueprintString, SiteBlueprint } from "../config/site-blueprint";
import { BlueprintEditor } from "../components/blueprint-editor";
import { useSites } from "../config/sites-store";
import { useUsers } from "../config/users-store";
import { SitesManager } from "../components/sites-manager";
import { UsersManager } from "../components/users-manager";
import { AlertsPanel, AlertsBell } from "../components/alerts-panel";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const CHART_COLORS = {
  amber: "#ff9900",
  blue: "#0079F2",
  cyan: "#06b6d4",
  green: "#16a34a",
  red: "#dc2626",
  slate: "#475569",
  purple: "#795EFF",
};

type StatusLevel = "online" | "warning" | "fault";

const METRIC_DEFINITIONS = {
  temperatureC: {
    aliases: ["temperatureC", "temperature", "temp"],
    names: ["temperature", "temperatureC", "temp"],
    addresses: ["1", "40001", "30001"],
  },
  flowLpm: {
    aliases: ["flowLpm", "flow", "flowRate"],
    names: ["flow", "flowRate", "flowLpm"],
    addresses: ["2", "40002", "30002"],
  },
  voltageV: {
    aliases: ["voltageV", "voltage"],
    names: ["voltage", "voltageV"],
    addresses: ["3", "40003", "30003"],
  },
  powerW: {
    aliases: ["powerW", "power"],
    names: ["power", "powerW"],
    addresses: ["30004"],
  },
  energyKwh: {
    aliases: ["energyKwh", "energy"],
    names: ["energy", "energyKwh"],
    addresses: ["30005"],
  },
  rssiDbm: {
    aliases: ["rssiDbm", "rssi"],
    names: ["rssi", "rssiDbm"],
    addresses: ["30100"],
  },
  signalQuality: {
    aliases: ["signalQuality", "signal", "quality"],
    names: ["signalQuality", "signal", "quality"],
    addresses: ["30101"],
  },
  relayState: {
    aliases: ["relayState", "relay", "relay_state"],
    names: ["relay_state", "relay", "relayState"],
    addresses: ["4", "40004"],
  },
  alarmState: {
    aliases: ["alarmState", "alarm", "alarm_state"],
    names: ["alarm_state", "alarm", "alarmState"],
    addresses: ["5", "40005"],
  },
} as const;

type ChartPayloadEntry = {
  color?: string;
  name?: string;
  value?: string | number | boolean | null;
};

type TooltipProps = {
  active?: boolean;
  payload?: ChartPayloadEntry[];
  label?: string | number;
};

type LegendProps = {
  payload?: Array<{
    color?: string;
    value?: string | number;
  }>;
};

type ParsedReading = {
  id: number;
  deviceId: string;
  source: string | null;
  tokenSlot: "current" | "previous" | null;
  receivedAt: string;
  timeLabel: string;
  dateLabel: string;
  temperatureC: number | null;
  flowLpm: number | null;
  voltageV: number | null;
  powerW: number | null;
  energyKwh: number | null;
  rssiDbm: number | null;
  signalQuality: number | null;
  relayState: boolean | null;
  alarmState: boolean | null;
  decodedCount: number;
  status: string;
  decodedStatus: string;
  parsingStatus: string;
  decodedRegisters: ModbusDecodedRegister[];
};

type StringRuntime = {
  string: BlueprintString;
  reading: ParsedReading | null;
  status: StatusLevel;
  statusLabel: string;
  color: string;
  minutesSinceData: number | null;
  powerW: number | null;
  signalQuality: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 0) return false;
    if (value === 1) return true;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["0", "false", "off", "normal", "inactive", "closed"].includes(normalized)) return false;
    if (["1", "true", "on", "alarm", "active", "open"].includes(normalized)) return true;
  }
  return null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getRawValues(rawPayload: ModbusReadingRawPayload): Record<string, unknown> {
  if (isRecord(rawPayload.values)) return rawPayload.values;
  if (isRecord(rawPayload.payload) && isRecord(rawPayload.payload.values)) return rawPayload.payload.values;
  return {};
}

function getRawRegisters(rawPayload: ModbusReadingRawPayload): Record<string, unknown> {
  if (isRecord(rawPayload.registers)) return rawPayload.registers;
  if (isRecord(rawPayload.payload) && isRecord(rawPayload.payload.registers)) return rawPayload.payload.registers;
  return {};
}

function getProvidedValues(reading: ModbusReading): Record<string, unknown> {
  if (isRecord(reading.decodedValues?.providedValues)) return reading.decodedValues.providedValues;
  return getRawValues(reading.rawPayload);
}

function valueFromMap(values: Record<string, unknown>, aliases: readonly string[]) {
  const normalizedAliases = aliases.map(normalizeKey);
  const entry = Object.entries(values).find(([key]) => normalizedAliases.includes(normalizeKey(key)));
  return entry?.[1];
}

function decodedRegister(
  registers: ModbusDecodedRegister[],
  names: readonly string[],
  addresses: readonly string[],
) {
  const normalizedNames = names.map(normalizeKey);
  const addressSet = new Set(addresses);
  return registers.find((register) => {
    return register.status === "decoded" && (normalizedNames.includes(normalizeKey(register.name)) || addressSet.has(register.address));
  });
}

function metricNumber(
  reading: ModbusReading,
  aliases: readonly string[],
  names: readonly string[],
  addresses: readonly string[],
) {
  const provided = numericValue(valueFromMap(getProvidedValues(reading), aliases));
  if (provided !== null) return provided;

  const register = decodedRegister(reading.decodedValues?.registers ?? [], names, addresses);
  const decoded = numericValue(register?.value);
  if (decoded !== null) return decoded;

  const rawRegisters = getRawRegisters(reading.rawPayload);
  const rawRegister = addresses.map((address) => numericValue(rawRegisters[address])).find((value) => value !== null);
  return rawRegister ?? null;
}

function metricBoolean(reading: ModbusReading, aliases: readonly string[], names: readonly string[], addresses: readonly string[]) {
  const provided = booleanValue(valueFromMap(getProvidedValues(reading), aliases));
  if (provided !== null) return provided;

  const register = decodedRegister(reading.decodedValues?.registers ?? [], names, addresses);
  const decoded = booleanValue(register?.value);
  if (decoded !== null) return decoded;

  const rawRegisters = getRawRegisters(reading.rawPayload);
  const rawRegister = addresses.map((address) => booleanValue(rawRegisters[address])).find((value) => value !== null);
  return rawRegister ?? null;
}

function safeFormatDate(date: string, pattern: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "Unknown time" : format(parsed, pattern);
}

function formatMetric(value: number | null, digits = 1) {
  return value === null ? "--" : value.toFixed(digits);
}

function formatBoolean(value: boolean | null) {
  if (value === null) return "--";
  return value ? "On" : "Off";
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function statusColor(status: StatusLevel): string {
  if (status === "online") return CHART_COLORS.green;
  if (status === "warning") return CHART_COLORS.amber;
  return CHART_COLORS.red;
}

function evaluateStringStatus(
  string: BlueprintString,
  reading: ParsedReading | null,
  stalenessThresholdMinutes: number,
): Omit<StringRuntime, "string"> {
  if (!reading) {
    return {
      reading: null,
      status: "fault",
      statusLabel: "No data",
      color: CHART_COLORS.red,
      minutesSinceData: null,
      powerW: null,
      signalQuality: null,
    };
  }

  const minutesSinceData = Math.round((Date.now() - new Date(reading.receivedAt).getTime()) / 60000);
  const powerW = reading.powerW;
  const signalQuality = reading.signalQuality;
  const decodedHasInvalid = reading.decodedStatus === "contains_invalid_registers";
  const stale = minutesSinceData > stalenessThresholdMinutes;
  const severelyStale = minutesSinceData > stalenessThresholdMinutes * 3;
  const weakSignal = signalQuality !== null && signalQuality < 60;
  const lowPower = powerW !== null && powerW < string.expectedPowerW * 0.35;

  if (severelyStale || decodedHasInvalid || weakSignal || lowPower) {
    return {
      reading,
      status: "fault",
      statusLabel: severelyStale
        ? `No data for ${minutesSinceData} min`
        : weakSignal ? "Weak signal" : lowPower ? "Low output" : "Invalid register",
      color: CHART_COLORS.red,
      minutesSinceData,
      powerW,
      signalQuality,
    };
  }

  if (stale) {
    return {
      reading,
      status: "warning",
      statusLabel: `Stale data (${minutesSinceData} min)`,
      color: CHART_COLORS.amber,
      minutesSinceData,
      powerW,
      signalQuality,
    };
  }

  if (reading.decodedStatus === "contains_unknown_registers" || (signalQuality !== null && signalQuality < 75)) {
    return {
      reading,
      status: "warning",
      statusLabel: "Needs review",
      color: CHART_COLORS.amber,
      minutesSinceData,
      powerW,
      signalQuality,
    };
  }

  return {
    reading,
    status: "online",
    statusLabel: "Generating",
    color: CHART_COLORS.green,
    minutesSinceData,
    powerW,
    signalQuality,
  };
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-sm text-card-foreground">
      <div className="mb-1 font-semibold">{label}</div>
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div key={`${entry.name}-${index}`} className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-semibold">
              {typeof entry.value === "number" ? (Number.isInteger(entry.value) ? entry.value : entry.value.toFixed(2)) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomLegend({ payload }: LegendProps) {
  if (!payload || payload.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 pt-3 text-xs">
      {payload.map((entry, index) => (
        <div key={`${entry.value}-${index}`} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="px-6 py-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <AlertTriangle className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">No TRB246 readings received yet</h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
          Configure the TRB246 or Modbus reader to send JSON readings to <span className="font-mono text-foreground">/api/modbus/readings</span>. Once the first payload arrives, SolarNexus will show live device status, the last received time, decoded register values, and historical trends.
        </p>
        <div className="mx-auto mt-5 max-w-2xl rounded-lg border bg-muted/40 p-4 text-left text-xs text-muted-foreground">
          <p className="mb-2 font-semibold text-foreground">Expected payload shape</p>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono">{`{
  "deviceId": "TRB246-GATEWAY-01",
  "registers": { "40001": 224, "40002": 1520, "40003": 24100, "40004": 1 }
}`}</pre>
        </div>
      </CardContent>
    </Card>
  );
}

function NoDecodedValuesState() {
  return (
    <Card className="lg:col-span-2">
      <CardContent className="px-6 py-8 text-center">
        <h3 className="text-base font-semibold text-foreground">Readings are arriving, but no numeric values are decoded yet</h3>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
          Historical charts appear after incoming payloads include known register addresses or decoded values. Confirm the TRB246 register map matches the registers your device is sending.
        </p>
      </CardContent>
    </Card>
  );
}

function PlantSimulation({ blueprint, strings, loading, latest }: { blueprint: SiteBlueprint; strings: StringRuntime[]; loading: boolean; latest?: ParsedReading | null }) {
  const kpis = computePlantKpis(blueprint, strings, latest ?? null);
  const siteBlueprint = blueprint;
  const online = strings.filter((item) => item.status === "online").length;
  const warning = strings.filter((item) => item.status === "warning").length;
  const fault = strings.filter((item) => item.status === "fault").length;
  const health = strings.length ? Math.round((online / strings.length) * 100) : 0;
  const totalPowerW = strings.reduce((sum, item) => sum + (item.powerW ?? 0), 0);
  const livePowerLabel = totalPowerW >= 1000
    ? `${(totalPowerW / 1000).toFixed(2)} kW`
    : `${totalPowerW.toFixed(1)} W`;

  // Compute inverter status once so both the line glow and the inverter
  // node share the same color.
  const inverterStatusById = new Map<string, StatusLevel>();
  siteBlueprint.inverters.forEach((inverter) => {
    const linked = strings.filter((item) => item.string.inverterId === inverter.id);
    const status: StatusLevel = linked.some((item) => item.status === "fault")
      ? "fault"
      : linked.some((item) => item.status === "warning")
        ? "warning"
        : "online";
    inverterStatusById.set(inverter.id, status);
  });

  // Plant-wide aggregated status drives the SCADA → Grid trunk line.
  const trunkStatus: StatusLevel = fault > 0 ? "fault" : warning > 0 ? "warning" : "online";
  const trunkColor = statusColor(trunkStatus);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Network className="h-5 w-5 text-primary" />
            Site Blueprint Simulation
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {siteBlueprint.siteName} • {siteBlueprint.capacityMw} MW • live single-line diagram
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden flex-col items-end leading-tight md:flex">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Live output</span>
            <span className="text-base font-bold text-emerald-600">{livePowerLabel}</span>
          </div>
          <Badge className="bg-emerald-600 text-white">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {online} online
          </Badge>
          <Badge className="bg-amber-500 text-white">{warning} warning</Badge>
          <Badge className="bg-red-600 text-white">{fault} fault</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[520px] w-full rounded-xl" />
        ) : (
          <div className="space-y-4">
          <PlantKpiRibbon kpis={kpis} />
          <div className="grid gap-5 xl:grid-cols-[1fr_330px]">
            <div className="relative min-h-[560px] overflow-hidden rounded-2xl border bg-[radial-gradient(circle_at_top_left,rgba(255,153,0,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.10),transparent_35%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)))]">
              <ScadaActionPanel />
              {/* Engineering grid backdrop */}
              <div className="pointer-events-none absolute inset-0 opacity-[0.22]" style={{ backgroundImage: "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
              <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: "140px 140px" }} />

              {/* Zones with gradient panels and corner ticks */}
              {siteBlueprint.zones.map((zone) => (
                <div
                  key={zone.id}
                  className="absolute rounded-xl border border-border/80 bg-background/55 p-3 backdrop-blur-sm shadow-sm"
                  style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%` }}
                >
                  <div className="absolute -top-2 left-3 rounded-full border bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {zone.name}
                  </div>
                  {/* Subtle solar-panel cell pattern */}
                  <div className="pointer-events-none absolute inset-3 rounded-lg opacity-30" style={{ backgroundImage: "linear-gradient(rgba(56,189,248,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.18) 1px, transparent 1px)", backgroundSize: "16px 16px" }} />
                  {/* Corner ticks */}
                  {(["top-1 left-1", "top-1 right-1", "bottom-1 left-1", "bottom-1 right-1"] as const).map((pos) => (
                    <span key={pos} className={`pointer-events-none absolute h-2 w-2 border-primary/60 ${pos} ${pos.includes("left") ? "border-l" : "border-r"} ${pos.includes("top") ? "border-t" : "border-b"}`} />
                  ))}
                </div>
              ))}

              {/* Power-flow paths: animated bezier curves from strings → inverters → SCADA → Grid.
                  Uses a 0–100 viewBox stretched to fit so we can express anchors and Bezier control
                  points in the same coordinate space the panels use (percentages). vectorEffect keeps
                  the stroke a constant pixel width regardless of the non-uniform stretch. */}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              >
                {/* String → Inverter curves */}
                {siteBlueprint.strings.map((string) => {
                  const inverter = siteBlueprint.inverters.find((item) => item.id === string.inverterId);
                  if (!inverter) return null;
                  const runtime = strings.find((item) => item.string.id === string.id);
                  const lineStatus = runtime?.status ?? "fault";
                  const color = statusColor(lineStatus);
                  const animate = lineStatus !== "fault";

                  // String panel: ~12% wide × 8% tall. Inverter: ~12% wide × 11% tall.
                  // Anchor on whichever side faces the inverter so curves leave from the proper edge.
                  const stringCenterX = string.x + 6;
                  const inverterCenterX = inverter.x + 6;
                  const fromRight = stringCenterX <= inverterCenterX;
                  const sx = fromRight ? string.x + 12 : string.x;
                  const sy = string.y + 4;
                  const tx = fromRight ? inverter.x : inverter.x + 12;
                  const ty = inverter.y + 5.5;
                  const dx = tx - sx;
                  const cx1 = sx + dx * 0.5;
                  const cx2 = tx - dx * 0.5;
                  const d = `M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`;

                  return (
                    <g key={string.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeDasharray={lineStatus === "fault" ? "5 5" : "6 4"}
                        opacity="0.85"
                        vectorEffect="non-scaling-stroke"
                      >
                        {animate && (
                          <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1.4s" repeatCount="indefinite" />
                        )}
                      </path>
                      {/* Junction dot at inverter anchor */}
                      <circle cx={tx} cy={ty} r="0.6" fill={color} opacity="0.9" />
                    </g>
                  );
                })}

                {/* Inverter → SCADA bus (SCADA box is at left:82%, top:18%, w:12%, h ≈ 14%) */}
                {siteBlueprint.inverters.map((inverter) => {
                  const status = inverterStatusById.get(inverter.id) ?? "fault";
                  const color = statusColor(status);
                  const inverterCenterX = inverter.x + 6;
                  const scadaCenterX = 82 + 6;
                  const fromRight = inverterCenterX <= scadaCenterX;
                  const sx = fromRight ? inverter.x + 12 : inverter.x;
                  const sy = inverter.y + 5.5;
                  const tx = fromRight ? 82 : 82 + 12;
                  const ty = 25;
                  const dx = tx - sx;
                  const cx1 = sx + dx * 0.55;
                  const cx2 = tx - dx * 0.55;
                  const d = `M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`;
                  return (
                    <g key={`inv-bus-${inverter.id}`}>
                      <path
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeDasharray="6 4"
                        opacity="0.7"
                        vectorEffect="non-scaling-stroke"
                      >
                        {status !== "fault" && (
                          <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1.6s" repeatCount="indefinite" />
                        )}
                      </path>
                      <circle cx={tx} cy={ty} r="0.7" fill={color} opacity="0.9" />
                    </g>
                  );
                })}

                {/* SCADA → Grid trunk (vertical drop on the right rail) */}
                <g>
                  <path
                    d={`M 88 32 C 88 42, 88 52, 88 62`}
                    fill="none"
                    stroke={trunkColor}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="8 4"
                    opacity="0.9"
                    vectorEffect="non-scaling-stroke"
                  >
                    {trunkStatus !== "fault" && (
                      <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.2s" repeatCount="indefinite" />
                    )}
                  </path>
                  <circle cx={88} cy={62} r="0.9" fill={trunkColor} opacity="0.95" />
                </g>
              </svg>

              {/* String panels — shaped like miniature PV modules */}
              {strings.map((item) => (
                <div
                  key={item.string.id}
                  className="group absolute h-12 w-24 rounded-md border-2 px-1.5 py-1 text-[10px] font-semibold shadow-sm transition-transform hover:z-20 hover:scale-110"
                  title={`${item.string.name}: ${item.statusLabel}${item.powerW !== null ? ` • ${item.powerW.toFixed(1)} W` : ""}`}
                  style={{
                    left: `${item.string.x}%`,
                    top: `${item.string.y}%`,
                    borderColor: item.color,
                    backgroundColor: `${item.color}1f`,
                    color: item.color,
                    boxShadow: item.status === "online" ? `0 0 0 2px ${item.color}22, 0 4px 16px -8px ${item.color}` : undefined,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{item.string.name.replace("String ", "")}</span>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${item.status === "online" ? "animate-pulse" : ""}`}
                      style={{ backgroundColor: item.color }}
                    />
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1 text-[9px] opacity-90">
                    {item.powerW === null ? (
                      <span>No data</span>
                    ) : (
                      <>
                        <span className="font-bold">{item.powerW.toFixed(1)}</span>
                        <span className="opacity-70">W</span>
                      </>
                    )}
                  </div>
                  {/* Mini PV cells */}
                  <div className="pointer-events-none absolute inset-x-1 bottom-0.5 flex h-1 gap-px opacity-60">
                    <span className="flex-1 rounded-sm" style={{ backgroundColor: item.color }} />
                    <span className="flex-1 rounded-sm" style={{ backgroundColor: item.color }} />
                    <span className="flex-1 rounded-sm" style={{ backgroundColor: item.color }} />
                    <span className="flex-1 rounded-sm" style={{ backgroundColor: item.color }} />
                  </div>
                </div>
              ))}

              {/* Inverters */}
              {siteBlueprint.inverters.map((inverter) => {
                const status = inverterStatusById.get(inverter.id) ?? "fault";
                const color = statusColor(status);
                const linked = strings.filter((item) => item.string.inverterId === inverter.id);
                const inverterPowerW = linked.reduce((sum, item) => sum + (item.powerW ?? 0), 0);
                return (
                  <div
                    key={inverter.id}
                    className="absolute flex h-16 w-24 flex-col items-center justify-center rounded-xl border-2 bg-card/95 text-center text-[10px] font-bold shadow-md backdrop-blur-sm"
                    style={{
                      left: `${inverter.x}%`,
                      top: `${inverter.y}%`,
                      borderColor: color,
                      color,
                      boxShadow: status === "online" ? `0 0 0 3px ${color}22, 0 6px 18px -10px ${color}` : undefined,
                    }}
                    title={`${inverter.name} • ${linked.length} strings • ${inverterPowerW.toFixed(1)} W`}
                  >
                    <span className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${status === "online" ? "animate-pulse" : ""}`} style={{ backgroundColor: color }} />
                    <Cpu className="mb-0.5 h-4 w-4" />
                    <span>{inverter.name.replace("Inverter ", "INV ")}</span>
                    <span className="mt-0.5 text-[9px] font-semibold opacity-80">
                      {inverterPowerW >= 1000 ? `${(inverterPowerW / 1000).toFixed(1)} kW` : `${inverterPowerW.toFixed(0)} W`}
                    </span>
                  </div>
                );
              })}

              {/* SCADA / TRB246 room */}
              <div className="absolute left-[82%] top-[18%] flex h-20 w-24 flex-col items-center justify-center rounded-xl border-2 border-primary bg-card/95 text-center text-[10px] font-bold text-primary shadow-md backdrop-blur-sm">
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                <Building2 className="mb-1 h-5 w-5" />
                <span>SCADA</span>
                <span className="text-[9px] font-semibold opacity-80">TRB246</span>
              </div>

              {/* Grid export */}
              <div className="absolute left-[82%] top-[64%] flex h-20 w-24 flex-col items-center justify-center rounded-xl border-2 border-blue-500 bg-card/95 text-center text-[10px] font-bold text-blue-600 shadow-md backdrop-blur-sm">
                <Zap className="mb-1 h-5 w-5" />
                <span>Grid Export</span>
                <span className="text-[9px] font-semibold opacity-80">{livePowerLabel}</span>
              </div>

              {/* Legend */}
              <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-full border bg-background/85 px-3 py-1.5 text-[10px] font-semibold backdrop-blur-sm">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Online</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Warning</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> Fault</span>
              </div>
            </div>
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Plant Health</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-end justify-between">
                    <span className="text-4xl font-bold text-green-600">{health}%</span>
                    <span className="text-sm text-muted-foreground">{strings.length} configured strings</span>
                  </div>
                  <Progress value={health} className="h-2" />
                  <p className="text-sm text-muted-foreground">Green means data is live and values are within configured limits. Red means missing, stale, invalid, weak, or under-producing telemetry.</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Priority Exceptions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {strings.filter((item) => item.status !== "online").slice(0, 5).map((item) => (
                    <div key={item.string.id} className="rounded-lg border p-3" style={{ borderColor: item.color }}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold">{item.string.name}</span>
                        <Badge style={{ backgroundColor: item.color, color: "white" }}>{item.statusLabel}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.string.deviceId} • {item.string.mppt} • {item.minutesSinceData === null ? "no timestamp" : `${item.minutesSinceData} min since data`}
                      </p>
                    </div>
                  ))}
                  {strings.every((item) => item.status === "online") && (
                    <p className="text-sm text-muted-foreground">No active string exceptions.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type PlantKpis = {
  capacityMw: number;
  instDcKw: number;
  avgVoltageV: number | null;
  totalCurrentA: number | null;
  onlinePct: number;
  moduleTempC: number | null;
  signalQualityPct: number | null;
  lastUpdate: string;
  stringsTotal: number;
  stringsOnline: number;
};

function computePlantKpis(blueprint: SiteBlueprint, strings: StringRuntime[], latest: ParsedReading | null): PlantKpis {
  const capacityMw = blueprint.capacityMw;
  const reporting = strings.filter((item) => item.powerW !== null);
  const totalPowerW = reporting.reduce((sum, item) => sum + (item.powerW ?? 0), 0);
  const instDcKw = totalPowerW / 1000;
  const stringsTotal = strings.length;
  const stringsOnline = strings.filter((item) => item.status === "online").length;
  const onlinePct = stringsTotal ? (stringsOnline / stringsTotal) * 100 : 0;
  // Aggregate voltage / current from per-string readings only (no assumed efficiency).
  const voltageReadings = strings
    .map((item) => item.reading?.voltageV)
    .filter((v): v is number => typeof v === "number");
  const currentReadings = strings
    .map((item) => item.reading?.flowLpm)
    .filter((v): v is number => typeof v === "number");
  const avgVoltageV = voltageReadings.length
    ? voltageReadings.reduce((s, v) => s + v, 0) / voltageReadings.length
    : null;
  const totalCurrentA = currentReadings.length
    ? currentReadings.reduce((s, v) => s + v, 0)
    : null;
  return {
    capacityMw,
    instDcKw,
    avgVoltageV,
    totalCurrentA,
    onlinePct,
    moduleTempC: latest?.temperatureC ?? null,
    signalQualityPct: latest?.signalQuality ?? null,
    lastUpdate: latest?.timeLabel ?? "—",
    stringsTotal,
    stringsOnline,
  };
}

function PlantKpiRibbon({ kpis }: { kpis: PlantKpis }) {
  const tile = (label: string, value: string, sub?: string, color?: string, Icon?: typeof Sun) => (
    <div className="flex min-w-[120px] flex-1 flex-col gap-0.5 rounded-md border bg-card/80 px-3 py-2 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        <span>{label}</span>
      </div>
      <div className="text-base font-bold leading-tight" style={{ color: color ?? "hsl(var(--foreground))" }}>{value}</div>
      {sub ? <div className="text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
  const fmtNum = (v: number | null, digits = 1, suffix = "") => v === null ? "—" : `${v.toFixed(digits)}${suffix}`;
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border bg-gradient-to-br from-card to-muted/40 p-2">
      {tile("Capacity", `${kpis.capacityMw} MW`, "Configured", CHART_COLORS.slate, Activity)}
      {tile("Module Temp", fmtNum(kpis.moduleTempC, 1, " °C"), "Latest gateway reading", CHART_COLORS.amber, Thermometer)}
      {tile("Inst. DC Power", `${kpis.instDcKw.toFixed(2)} kW`, `${kpis.stringsOnline}/${kpis.stringsTotal} strings reporting`, CHART_COLORS.blue, Activity)}
      {tile("Avg Voltage", fmtNum(kpis.avgVoltageV, 2, " V"), "Mean of string readings", CHART_COLORS.purple, Zap)}
      {tile("Total Current", fmtNum(kpis.totalCurrentA, 2, " A"), "Sum of string readings", CHART_COLORS.cyan, Activity)}
      {tile("Signal Quality", fmtNum(kpis.signalQualityPct, 0, " %"), "Latest gateway", CHART_COLORS.green, Gauge)}
      {tile("Online", `${kpis.onlinePct.toFixed(0)}%`, `${kpis.stringsOnline}/${kpis.stringsTotal} strings`, kpis.onlinePct > 90 ? CHART_COLORS.green : kpis.onlinePct > 60 ? CHART_COLORS.amber : CHART_COLORS.red, Gauge)}
      {tile("Last Update", kpis.lastUpdate, kpis.lastUpdate === "—" ? "No data yet" : "Latest reading time", CHART_COLORS.amber, TrendingUp)}
    </div>
  );
}

function ScadaActionPanel() {
  const [active, setActive] = useState<string>("");
  const items: { id: string; label: string; Icon: typeof Sun }[] = [
    { id: "meter", label: "Meter Parameters", Icon: Gauge },
    { id: "breaker", label: "Breaker Status", Icon: Activity },
    { id: "menu", label: "Menu", Icon: Settings },
    { id: "shutdown", label: "Shut Down", Icon: Power },
  ];
  return (
    <div className="absolute right-3 top-3 flex flex-col gap-1.5">
      {items.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setActive(active === id ? "" : id)}
          className={`flex items-center gap-2 rounded-md border bg-background/85 px-3 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur-sm transition-colors hover:bg-background ${active === id ? "border-primary text-primary" : "text-foreground"}`}
          title={label}
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{label}</span>
          <Lock className="h-3 w-3 opacity-40" />
        </button>
      ))}
      {active ? (
        <div className="mt-1 rounded-md border bg-background/95 px-3 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm">
          <strong className="text-foreground">{items.find((i) => i.id === active)?.label}:</strong> view-only in this build.
        </div>
      ) : null}
    </div>
  );
}

function SingleLineDiagram({ blueprint, strings, loading }: { blueprint: SiteBlueprint; strings: StringRuntime[]; loading: boolean }) {
  // Per-inverter aggregated values, derived only from live string readings
  const inverters = blueprint.inverters.map((inverter) => {
    const linked = strings.filter((item) => item.string.inverterId === inverter.id);
    const reportingPower = linked.filter((item) => item.powerW !== null);
    const dcKw = reportingPower.length
      ? reportingPower.reduce((sum, item) => sum + (item.powerW ?? 0), 0) / 1000
      : null;
    const voltages = linked.map((item) => item.reading?.voltageV).filter((v): v is number => typeof v === "number");
    const currents = linked.map((item) => item.reading?.flowLpm).filter((v): v is number => typeof v === "number");
    const kv = voltages.length ? (voltages.reduce((s, v) => s + v, 0) / voltages.length) / 1000 : null;
    const amp = currents.length ? currents.reduce((s, v) => s + v, 0) : null;
    const status: StatusLevel = linked.some((item) => item.status === "fault")
      ? "fault"
      : linked.some((item) => item.status === "warning")
        ? "warning"
        : "online";
    return { inverter, dcKw, status, kv, amp };
  });
  const reportingInverters = inverters.filter((i) => i.dcKw !== null);
  const totalKw = reportingInverters.length
    ? reportingInverters.reduce((sum, i) => sum + (i.dcKw ?? 0), 0)
    : null;
  const reportingAmps = inverters.filter((i) => i.amp !== null);
  const totalAmp = reportingAmps.length
    ? reportingAmps.reduce((sum, i) => sum + (i.amp ?? 0), 0)
    : null;
  const reportingKvs = inverters.filter((i) => i.kv !== null);
  const trunkKv = reportingKvs.length
    ? reportingKvs.reduce((sum, i) => sum + (i.kv ?? 0), 0) / reportingKvs.length
    : null;
  const trunkStatus: StatusLevel = inverters.some((item) => item.status === "fault")
    ? "fault"
    : inverters.some((item) => item.status === "warning")
      ? "warning"
      : "online";

  const breakerCount = Math.max(inverters.length, 1);
  const breakerColumnWidth = 100 / (breakerCount + 1); // leave margin
  const breakerXs = inverters.map((_, i) => (i + 1) * breakerColumnWidth);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Workflow className="h-5 w-5 text-primary" /> 11 kV Single-Line Diagram
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {blueprint.siteName} • Grid export, bus bars, breakers and inverter feeders
          </p>
        </div>
        <div className="flex flex-col items-end leading-tight">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Plant DC Power</span>
          <span className="text-base font-bold text-emerald-600">{totalKw === null ? "—" : `${totalKw.toFixed(2)} kW`}</span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[520px] w-full rounded-xl" />
        ) : (
          <div className="relative min-h-[560px] overflow-hidden rounded-2xl border bg-slate-950 p-4 text-slate-100">
            {/* Grid header label */}
            <div className="absolute left-1/2 top-3 -translate-x-1/2 text-center">
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-300">GRID</div>
            </div>

            {/* OD breaker meter card */}
            <div className="absolute left-1/2 top-10 flex -translate-x-1/2 flex-col items-center gap-1">
              <MeterCard label="OD_BRE" kw={totalKw} amp={totalAmp} kv={trunkKv} status={trunkStatus} />
            </div>

            {/* Top bus bar label */}
            <div className="absolute left-3 top-[26%] text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">11 kV BUS BAR (Outgoing)</div>
            {/* OG breaker meter card (incoming) */}
            <div className="absolute left-1/2 top-[33%] flex -translate-x-1/2 flex-col items-center gap-1">
              <MeterCard label="OG_BRE" kw={totalKw} amp={totalAmp} kv={trunkKv} status={trunkStatus} />
            </div>

            {/* Lower bus bar label */}
            <div className="absolute left-3 top-[55%] text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">11 kV BUS BAR (Incoming)</div>

            {/* Breakers + inverters row at bottom */}
            <div className="absolute inset-x-4 bottom-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${inverters.length}, minmax(0, 1fr)) minmax(0, 0.8fr)` }}>
              {inverters.map(({ inverter, dcKw, status, kv, amp }) => (
                <div key={inverter.id} className="flex flex-col items-center gap-2">
                  <MeterCard label={`HT_BRE${inverter.name.replace(/\D+/g, "")}`} kw={dcKw} amp={amp} kv={kv} status={status} dense />
                  <div className={`flex h-20 w-full flex-col items-center justify-center rounded-lg border-2 bg-slate-900 text-[10px] font-bold ${status === "online" ? "border-emerald-400 text-emerald-300" : status === "warning" ? "border-amber-400 text-amber-300" : "border-red-500 text-red-300"}`}>
                    <Cpu className="mb-1 h-5 w-5" />
                    <span>{inverter.name.replace("Inverter ", "INV ")}</span>
                    <span className="mt-0.5 text-[9px] opacity-80">{dcKw === null ? "— kW" : `${dcKw.toFixed(2)} kW`}</span>
                  </div>
                </div>
              ))}
              <div className="flex flex-col items-center gap-2">
                <MeterCard label="AUX_BRE" kw={null} amp={null} kv={null} status="online" dense />
                <div className="flex h-20 w-full flex-col items-center justify-center rounded-lg border-2 border-sky-400 bg-slate-900 text-[10px] font-bold text-sky-300">
                  <Building2 className="mb-1 h-5 w-5" />
                  <span>CONTROL ROOM</span>
                  <span className="mt-0.5 text-[9px] opacity-80">No aux meter</span>
                </div>
              </div>
            </div>

            {/* SVG bus bars + drop lines */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
              {/* Grid → OD vertical */}
              <line x1="50" y1="6" x2="50" y2="11" stroke="#fde047" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
              <polygon points="50,5 49,7 51,7" fill="#fde047" />
              {/* OD → top bus bar */}
              <line x1="50" y1="20" x2="50" y2="28" stroke="#fde047" strokeWidth="0.4" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke">
                <animate attributeName="stroke-dashoffset" from="6" to="0" dur="1.4s" repeatCount="indefinite" />
              </line>
              {/* Top bus bar (horizontal) */}
              <line x1="4" y1="28" x2="96" y2="28" stroke="#fde047" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
              {/* Top bus → OG */}
              <line x1="50" y1="28" x2="50" y2="33" stroke="#fde047" strokeWidth="0.4" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke">
                <animate attributeName="stroke-dashoffset" from="6" to="0" dur="1.4s" repeatCount="indefinite" />
              </line>
              {/* OG → lower bus */}
              <line x1="50" y1="42" x2="50" y2="56" stroke="#fde047" strokeWidth="0.4" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke">
                <animate attributeName="stroke-dashoffset" from="6" to="0" dur="1.4s" repeatCount="indefinite" />
              </line>
              {/* Lower bus bar */}
              <line x1="4" y1="56" x2="96" y2="56" stroke="#fde047" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
              {/* Drop to each breaker */}
              {breakerXs.map((xPct, idx) => {
                const status = inverters[idx]?.status ?? "online";
                const color = status === "online" ? "#34d399" : status === "warning" ? "#fbbf24" : "#f87171";
                return (
                  <g key={`drop-${idx}`}>
                    <line x1={xPct} y1="56" x2={xPct} y2="68" stroke={color} strokeWidth="0.4" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke">
                      {status !== "fault" && <animate attributeName="stroke-dashoffset" from="6" to="0" dur="1.2s" repeatCount="indefinite" />}
                    </line>
                    <rect x={xPct - 0.6} y="55.4" width="1.2" height="1.2" fill={color} />
                  </g>
                );
              })}
              {/* Aux drop */}
              <line x1={(inverters.length + 0.6) * breakerColumnWidth} y1="56" x2={(inverters.length + 0.6) * breakerColumnWidth} y2="68" stroke="#38bdf8" strokeWidth="0.4" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke">
                <animate attributeName="stroke-dashoffset" from="6" to="0" dur="1.2s" repeatCount="indefinite" />
              </line>
            </svg>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MeterCard({ label, kw, amp, kv, status, dense }: { label: string; kw: number | null; amp: number | null; kv: number | null; status: StatusLevel; dense?: boolean }) {
  const color = status === "online" ? "#34d399" : status === "warning" ? "#fbbf24" : "#f87171";
  const fmt = (v: number | null) => v === null ? "—" : v.toFixed(2);
  return (
    <div className={`flex ${dense ? "min-w-[110px]" : "min-w-[170px]"} flex-col rounded-md border border-slate-700 bg-slate-900/95 ${dense ? "px-2 py-1" : "px-3 py-1.5"} font-mono text-[10px] shadow-md`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">{label}</span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
      </div>
      <Row k="KW" v={fmt(kw)} color={color} />
      <Row k="AMP" v={fmt(amp)} color={color} />
      <Row k="KV" v={fmt(kv)} color={color} />
    </div>
  );
}

function Row({ k, v, color }: { k: string; v: string; color: string }) {
  return (
    <div className="grid grid-cols-[34px_1fr] items-center gap-2 border-t border-slate-800 px-1 py-0.5 first:border-t-0">
      <span className="text-amber-200/90">{k}</span>
      <span className="text-right font-bold tabular-nums" style={{ color }}>{v}</span>
    </div>
  );
}

function FormulaeView({ blueprint, strings }: { blueprint: SiteBlueprint; strings: StringRuntime[] }) {
  const reportingPower = strings.filter((item) => item.powerW !== null);
  const totalPowerW = reportingPower.reduce((sum, item) => sum + (item.powerW ?? 0), 0);
  const instDcKw = reportingPower.length ? totalPowerW / 1000 : null;
  const capacityKw = blueprint.capacityMw * 1000;

  // Voltage / current measured per string (no assumed conversion factors)
  const voltages = strings.map((s) => s.reading?.voltageV).filter((v): v is number => typeof v === "number");
  const currents = strings.map((s) => s.reading?.flowLpm).filter((v): v is number => typeof v === "number");
  const avgVoltage = voltages.length ? voltages.reduce((s, v) => s + v, 0) / voltages.length : null;
  const totalCurrent = currents.length ? currents.reduce((s, v) => s + v, 0) : null;
  const smbPowerKw = avgVoltage !== null && totalCurrent !== null
    ? (avgVoltage * totalCurrent) / 1000
    : null;

  // CUF over the current snapshot uses measured DC kW vs installed capacity
  const cuf = instDcKw !== null && capacityKw > 0 ? (instDcKw * 100) / capacityKw : null;

  // Plant equivalents (kg/MWh factors from IPCC + IEA averages)
  // Without an energy-accumulator we cannot report today's energy yet.
  const todayEnergyKwh: number | null = null;
  const co2Tons = todayEnergyKwh !== null ? todayEnergyKwh * 0.00067 : null;
  const dieselTons = todayEnergyKwh !== null ? todayEnergyKwh * 0.000268 : null;
  const trees = todayEnergyKwh !== null ? todayEnergyKwh * 0.0166 : null;

  const fmt = (v: number | null, digits = 2, suffix = "") => v === null ? "—" : `${v.toFixed(digits)}${suffix}`;

  const F = ({ title, expression, result, unit, note }: { title: string; expression: React.ReactNode; result: string; unit?: string; note?: string }) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-[0.16em] text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-muted/40 p-3 font-mono text-[12px] leading-relaxed text-foreground">
          {expression}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-emerald-600">{result}</span>
          {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
        </div>
        {note ? <p className="mt-1 text-[11px] text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );

  const Frac = ({ num, den }: { num: React.ReactNode; den: React.ReactNode }) => (
    <span className="inline-flex flex-col items-center align-middle">
      <span className="px-2">{num}</span>
      <span className="w-full border-t border-foreground/60" />
      <span className="px-2">{den}</span>
    </span>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" /> Formulae & Plant Equivalents</CardTitle>
          <p className="text-sm text-muted-foreground">
            Values derived strictly from the latest live snapshot of {blueprint.siteName} ({blueprint.capacityMw} MW). Metrics whose source is not yet wired display as "—".
          </p>
        </CardHeader>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <F
          title="Solar Irradiation (POA)"
          expression={<span><Frac num={<>(Avg Irradiation × Operating Hours)</>} den={<>1000</>} /></span>}
          result="—"
          unit="kWh/m²"
          note="Requires MET station feed (irradiance + operating hours)."
        />
        <F
          title="Performance Ratio (PR)"
          expression={<span><Frac num={<>Energy Generated (kWh) × 100</>} den={<>Nominal Energy Output (kWh)</>} /></span>}
          result="—"
          unit="%"
          note="Requires daily energy accumulator and MET-derived nominal."
        />
        <F
          title="Capacity Utilisation Factor (CUF) — snapshot"
          expression={<span><Frac num={<>Inst. DC Power × 100</>} den={<>Installed Capacity</>} /> = <Frac num={<>{instDcKw === null ? "—" : (instDcKw * 100).toFixed(2)}</>} den={<>{capacityKw.toFixed(0)}</>} /></span>}
          result={fmt(cuf, 3, " %")}
          note="Instantaneous CUF; daily CUF needs an energy accumulator."
        />
        <F
          title="Line Loss"
          expression={<span>LL = 100 − <Frac num={<>Total Energy Exported</>} den={<>Total Energy Generated</>} /> × 100</span>}
          result="—"
          unit="%"
          note="Requires feed-out meter + inverter accumulators."
        />
        <F
          title="Power in SMB"
          expression={<>P = Voltage × Total Current = {fmt(avgVoltage, 2)} × {fmt(totalCurrent, 2)}</>}
          result={fmt(smbPowerKw, 2, " kW")}
          note="Computed from per-string voltage and current readings only."
        />
        <F
          title="Transformer Loss / Efficiency"
          expression={<>η = <Frac num={<>Output</>} den={<>Input</>} /> × 100      Loss = Input − Output</>}
          result="—"
          unit="%"
          note="Requires HV-side and LV-side transformer meters."
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-[0.16em] text-muted-foreground">Plant Equivalents</CardTitle>
          <p className="text-[11px] text-muted-foreground">Computed from today's accumulated energy generation; awaiting daily energy meter.</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-emerald-500/5 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">CO₂ Reduction</div>
              <div className="mt-1 text-2xl font-bold text-emerald-600">{fmt(co2Tons, 4)}</div>
              <div className="text-[11px] text-muted-foreground">tons of CO₂ • 0.67 kg/kWh (IEA grid avg)</div>
            </div>
            <div className="rounded-lg border bg-amber-500/5 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Diesel Equivalent</div>
              <div className="mt-1 text-2xl font-bold text-amber-600">{fmt(dieselTons, 4)}</div>
              <div className="text-[11px] text-muted-foreground">tons of diesel • 0.268 kg/kWh @ 40% gen eff</div>
            </div>
            <div className="rounded-lg border bg-green-500/5 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Trees Equivalent</div>
              <div className="mt-1 text-2xl font-bold text-green-600">{fmt(trees, 2)}</div>
              <div className="text-[11px] text-muted-foreground">trees · year • 16.6 g CO₂ / tree-year</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type ReportPayload = {
  blueprint: SiteBlueprint;
  strings: StringRuntime[];
  latest: ParsedReading | null;
  operationalStrings: number;
  activeFaults: number;
  activeWarnings: number;
  lastReceivedDisplay: string;
  latestPower: number;
  latestSignal: number | string;
};

function buildReportRows(strings: StringRuntime[]) {
  return strings.map((item) => ({
    String: item.string.name,
    Device: item.string.deviceId,
    MPPT: item.string.mppt,
    Status: item.statusLabel,
    "Expected (W)": item.string.expectedPowerW,
    "Live (W)": item.powerW === null ? "" : Number(item.powerW.toFixed(2)),
    "Min Since Data": item.minutesSinceData ?? "",
  }));
}

function reportFilename(blueprint: SiteBlueprint, ext: string) {
  const slug = blueprint.siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `solarnexus-${slug}-report-${stamp}.${ext}`;
}

function exportReportPdf(p: ReportPayload) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("SolarNexus Operations Report", margin, y);
  y += 22;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`${p.blueprint.siteName} • ${p.blueprint.capacityMw} MW`, margin, y);
  y += 14;
  doc.setTextColor(100);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
  doc.setTextColor(0);
  y += 22;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Summary", margin, y);
  y += 16;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const summary = [
    `${p.operationalStrings} of ${p.strings.length} strings online; ${p.activeFaults} fault, ${p.activeWarnings} warning.`,
    `Latest gateway: ${p.latest?.deviceId ?? "no device"} received ${p.lastReceivedDisplay}.`,
    `Module temperature ${p.latest?.temperatureC?.toFixed(1) ?? "--"} °C, output ${p.latestPower.toFixed(1)} W, signal ${p.latestSignal}%.`,
  ];
  summary.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, 515);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 12;
  });
  y += 10;

  const rows = buildReportRows(p.strings);
  autoTable(doc, {
    startY: y,
    head: [["String", "Device", "MPPT", "Status", "Expected (W)", "Live (W)", "Min Since Data"]],
    body: rows.map((r) => [r.String, r.Device, r.MPPT, r.Status, r["Expected (W)"], r["Live (W)"], r["Min Since Data"]]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [255, 153, 0], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: margin, right: margin },
  });

  doc.save(reportFilename(p.blueprint, "pdf"));
}

function exportReportExcel(p: ReportPayload) {
  const wb = XLSX.utils.book_new();
  const summary = [
    ["SolarNexus Operations Report"],
    ["Site", p.blueprint.siteName],
    ["Capacity (MW)", p.blueprint.capacityMw],
    ["Generated", new Date().toLocaleString()],
    [],
    ["Strings online", `${p.operationalStrings} / ${p.strings.length}`],
    ["Active faults", p.activeFaults],
    ["Active warnings", p.activeWarnings],
    [],
    ["Latest device", p.latest?.deviceId ?? ""],
    ["Last received", p.lastReceivedDisplay],
    ["Module temperature (°C)", p.latest?.temperatureC ?? ""],
    ["Latest power (W)", Number(p.latestPower.toFixed(2))],
    ["Latest signal (%)", p.latestSignal],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary["!cols"] = [{ wch: 28 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  const rows = buildReportRows(p.strings);
  const wsStrings = XLSX.utils.json_to_sheet(rows);
  wsStrings["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsStrings, "Strings");

  XLSX.writeFile(wb, reportFilename(p.blueprint, "xlsx"));
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [isDark, setIsDark] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [location, navigate] = useLocation();
  const VALID_VIEWS = ["overview", "simulation", "single-line", "formulae", "analytics", "report", "alerts", "config", "sites", "users", "settings"] as const;
  const pathSegment = location.replace(/^\/+/, "").split("/")[0] || "overview";
  const activeView = (VALID_VIEWS as readonly string[]).includes(pathSegment) ? pathSegment : "overview";
  const setActiveView = (view: string) => navigate(`/${view}`);

  const [deviceFilter, setDeviceFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter] = useState<"hour" | "day" | "week" | "all" | "custom">("all");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const DEFAULT_STALENESS_THRESHOLD = 30;
  const DEFAULT_COOLDOWN_MINUTES = 60;
  const [thresholdSaveError, setThresholdSaveError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const parseLocalDateTime = (value: string): Date | null => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const customStartDate = useMemo(() => parseLocalDateTime(customStart), [customStart]);
  const customEndDate = useMemo(() => parseLocalDateTime(customEnd), [customEnd]);

  const customRangeError = useMemo<string | null>(() => {
    if (rangeFilter !== "custom") return null;
    if (customStart && !customStartDate) return "Start date is not a valid timestamp.";
    if (customEnd && !customEndDate) return "End date is not a valid timestamp.";
    if (customStartDate && customEndDate && customEndDate.getTime() <= customStartDate.getTime()) {
      return "End must be after start.";
    }
    if (!customStartDate && !customEndDate) {
      return "Pick a start time, an end time, or both.";
    }
    return null;
  }, [rangeFilter, customStart, customEnd, customStartDate, customEndDate]);

  const customRangeNotice = useMemo<string | null>(() => {
    if (rangeFilter !== "custom" || customRangeError) return null;
    const now = Date.now();
    if (customStartDate && customStartDate.getTime() > now) {
      return "Start is in the future. No readings will match until time catches up.";
    }
    if (customEndDate && customEndDate.getTime() > now) {
      return "End is in the future. Showing all readings up to now.";
    }
    return null;
  }, [rangeFilter, customRangeError, customStartDate, customEndDate]);

  const { sinceIso, untilIso } = useMemo<{ sinceIso?: string; untilIso?: string }>(() => {
    if (rangeFilter === "all") return {};
    if (rangeFilter === "custom") {
      if (customRangeError) return {};
      return {
        ...(customStartDate ? { sinceIso: customStartDate.toISOString() } : {}),
        ...(customEndDate ? { untilIso: customEndDate.toISOString() } : {}),
      };
    }
    const ms = rangeFilter === "hour" ? 60 * 60 * 1000 : rangeFilter === "day" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    return { sinceIso: new Date(nowTick - ms).toISOString() };
  }, [rangeFilter, nowTick, customRangeError, customStartDate, customEndDate]);

  const queryParams = useMemo(
    () => ({
      limit: 100,
      ...(deviceFilter !== "all" ? { deviceId: deviceFilter } : {}),
      ...(sinceIso ? { since: sinceIso } : {}),
      ...(untilIso ? { until: untilIso } : {}),
    }),
    [deviceFilter, sinceIso, untilIso],
  );
  const queryEnabled = !(rangeFilter === "custom" && customRangeError !== null);
  const { data: deviceListData } = useListModbusReadings({ limit: 100 });
  const { data, isLoading, isFetching, isError, error, dataUpdatedAt } = useListModbusReadings(
    queryParams,
    { query: { enabled: queryEnabled, placeholderData: queryEnabled ? undefined : { readings: [] }, queryKey: getListModbusReadingsQueryKey(queryParams) } },
  );
  const loading = queryEnabled && (isLoading || isFetching);

  const knownDeviceIds = useMemo(() => {
    const set = new Set<string>();
    (deviceListData?.readings ?? []).forEach((reading) => set.add(reading.deviceId));
    (data?.readings ?? []).forEach((reading) => set.add(reading.deviceId));
    return Array.from(set).sort();
  }, [deviceListData, data]);

  useEffect(() => {
    if (deviceFilter !== "all" && knownDeviceIds.length > 0 && !knownDeviceIds.includes(deviceFilter)) {
      setDeviceFilter("all");
    }
  }, [deviceFilter, knownDeviceIds]);

  const { users, currentUser, currentUserId, setCurrentUserId, addUser, updateUser, deleteUser } = useUsers();
  const [sessionUser, setSessionUser] = useState(() => getStoredUser());
  useEffect(() => {
    const sync = () => setSessionUser(getStoredUser());
    window.addEventListener("storage", sync);
    window.addEventListener("solarnexus:auth-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("solarnexus:auth-changed", sync);
    };
  }, []);
  const allowedSiteIds = currentUser?.role === "super-admin" ? ("all" as const) : (currentUser?.siteIds ?? []);
  const { sites, visibleSites, currentSite, currentSiteId, setCurrentSiteId, addSite, updateSite, deleteSite, setBlueprintForSite } =
    useSites(allowedSiteIds);
  const isSuperAdmin = currentUser?.role === "super-admin";

  const { data: siteThresholdsData } = useListSiteStalenessThresholds({
    query: {
      staleTime: 30_000,
      queryKey: getListSiteStalenessThresholdsQueryKey(),
    },
  });
  const siteThresholdsByScope = useMemo(() => {
    const map = new Map<
      string,
      { thresholdMinutes: number; cooldownMinutes: number }
    >();
    (siteThresholdsData?.thresholds ?? []).forEach((entry) => {
      map.set(entry.siteId, {
        thresholdMinutes: entry.thresholdMinutes,
        cooldownMinutes: entry.cooldownMinutes,
      });
    });
    return map;
  }, [siteThresholdsData]);
  const currentSiteOverride = currentSite
    ? siteThresholdsByScope.get(currentSite.id)
    : undefined;
  const stalenessThresholdMinutes =
    currentSiteOverride?.thresholdMinutes ?? DEFAULT_STALENESS_THRESHOLD;
  const cooldownMinutesValue =
    currentSiteOverride?.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
  const siteHasThresholdOverride =
    !!currentSite && siteThresholdsByScope.has(currentSite.id);
  type SiteThresholdsCache = {
    thresholds: {
      siteId: string;
      thresholdMinutes: number;
      cooldownMinutes: number;
      updatedAt: string;
    }[];
  };
  const saveSiteOverride = async (patch: {
    thresholdMinutes?: number;
    cooldownMinutes?: number;
  }) => {
    if (!currentSite) return;
    setThresholdSaveError(null);
    const targetSiteId = currentSite.id;
    const queryKey = getListSiteStalenessThresholdsQueryKey();
    // Read the freshest cached list — including any optimistic update from a
    // sibling edit that hasn't been confirmed by the server yet — so quick
    // consecutive edits to threshold + cooldown don't overwrite each other
    // with values derived from the last refetch.
    const cached = queryClient.getQueryData<SiteThresholdsCache>(queryKey);
    const existing = cached?.thresholds.find((t) => t.siteId === targetSiteId);
    const hasOverrideNow = !!existing;
    const merged = {
      thresholdMinutes:
        patch.thresholdMinutes ??
        existing?.thresholdMinutes ??
        DEFAULT_STALENESS_THRESHOLD,
      cooldownMinutes:
        patch.cooldownMinutes ??
        existing?.cooldownMinutes ??
        DEFAULT_COOLDOWN_MINUTES,
    };
    const isAllDefault =
      merged.thresholdMinutes === DEFAULT_STALENESS_THRESHOLD &&
      merged.cooldownMinutes === DEFAULT_COOLDOWN_MINUTES;
    const willDelete = isAllDefault && hasOverrideNow;
    const willUpsert = !isAllDefault || hasOverrideNow;
    // Optimistically update the cache so a second rapid edit (e.g. operator
    // changes the cooldown right after the threshold) merges against our
    // pending values rather than the stale server snapshot.
    const optimisticList: SiteThresholdsCache = {
      thresholds: willDelete
        ? (cached?.thresholds ?? []).filter((t) => t.siteId !== targetSiteId)
        : [
            ...(cached?.thresholds ?? []).filter(
              (t) => t.siteId !== targetSiteId,
            ),
            ...(willUpsert
              ? [
                  {
                    siteId: targetSiteId,
                    thresholdMinutes: merged.thresholdMinutes,
                    cooldownMinutes: merged.cooldownMinutes,
                    updatedAt: new Date().toISOString(),
                  },
                ]
              : []),
          ],
    };
    queryClient.setQueryData(queryKey, optimisticList);
    try {
      if (willDelete) {
        await deleteSiteStalenessThreshold(targetSiteId);
      } else if (willUpsert) {
        await upsertSiteStalenessThreshold({
          siteId: targetSiteId,
          thresholdMinutes: merged.thresholdMinutes,
          cooldownMinutes: merged.cooldownMinutes,
        });
      }
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      // Roll the cache back to what the server last told us so the UI doesn't
      // keep showing the failed optimistic value.
      if (cached) queryClient.setQueryData(queryKey, cached);
      else await queryClient.invalidateQueries({ queryKey });
      const message =
        err instanceof Error ? err.message : "Failed to save threshold.";
      setThresholdSaveError(
        message.includes("401") || message.includes("403")
          ? "Admin API token is required to change the per-site threshold. Open the alerts panel and paste it in."
          : message,
      );
    }
  };
  const setStalenessThresholdMinutes = (value: number) =>
    saveSiteOverride({ thresholdMinutes: value });
  const setCooldownMinutes = (value: number) =>
    saveSiteOverride({ cooldownMinutes: value });

  // Sync device→site mappings to the server so the background staleness
  // monitor can apply per-site thresholds/cooldowns. The endpoint is
  // admin-protected, so we skip the sync entirely when the operator hasn't
  // pasted an admin token (or isn't a super-admin) — otherwise non-admin
  // sessions would generate a steady stream of 401 console noise.
  useEffect(() => {
    if (!isSuperAdmin) return;
    if (!visibleSites || visibleSites.length === 0) return;
    if (typeof window === "undefined") return;
    const adminToken = (() => {
      try {
        return window.localStorage.getItem("solarnexus.adminApiToken");
      } catch {
        return null;
      }
    })();
    if (!adminToken) return;
    let cancelled = false;
    const debounce = setTimeout(() => {
      void (async () => {
        let anySucceeded = false;
        for (const site of visibleSites) {
          if (cancelled) return;
          const deviceIds = Array.from(
            new Set(
              [
                ...site.inverters.map((i) => i.deviceId),
                ...site.strings.map((s) => s.deviceId),
              ].filter((id): id is string => typeof id === "string" && id.length > 0),
            ),
          );
          try {
            await replaceSiteDeviceAssignments(site.id, { deviceIds });
            anySucceeded = true;
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `Failed to sync device assignments for site ${site.id}:`,
              err,
            );
          }
        }
        if (!cancelled && anySucceeded) {
          // Refresh the coverage panel so operators see the new mapping.
          await queryClient.invalidateQueries({
            queryKey: getListDeviceSiteAssignmentsQueryKey(),
          });
        }
      })();
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [visibleSites]);

  const siteBlueprint: SiteBlueprint = currentSite ?? {
    siteName: "No site",
    clientName: "",
    capacityMw: 0,
    location: "",
    zones: [],
    inverters: [],
    strings: [],
  };
  const setBlueprint = (next: SiteBlueprint) => {
    if (currentSite) setBlueprintForSite(currentSite.id, next);
  };
  const resetBlueprint = () => {
    if (currentSite) setBlueprintForSite(currentSite.id, { ...siteBlueprint });
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    if (loading) {
      setIsSpinning(true);
      return undefined;
    }
    const timeout = setTimeout(() => setIsSpinning(false), 500);
    return () => clearTimeout(timeout);
  }, [loading]);

  useEffect(() => {
    if (autoRefreshInterval <= 0) return undefined;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getListModbusReadingsQueryKey(queryParams) });
    }, autoRefreshInterval);
    return () => clearInterval(interval);
  }, [autoRefreshInterval, queryClient, queryParams]);

  const rawReadings = queryEnabled ? (data?.readings ?? []) : [];

  const parsedData = useMemo<ParsedReading[]>(() => {
    return [...rawReadings].reverse().map((reading: ModbusReading) => {
      const decodedRegisters = reading.decodedValues?.registers ?? [];
      const decodedCount = decodedRegisters.filter((register) => register.status === "decoded").length;

      return {
        id: reading.id,
        deviceId: reading.deviceId,
        source: reading.source,
        tokenSlot: reading.tokenSlot ?? null,
        receivedAt: reading.receivedAt,
        timeLabel: safeFormatDate(reading.receivedAt, "HH:mm:ss"),
        dateLabel: safeFormatDate(reading.receivedAt, "MMM dd, HH:mm"),
        temperatureC: metricNumber(reading, METRIC_DEFINITIONS.temperatureC.aliases, METRIC_DEFINITIONS.temperatureC.names, METRIC_DEFINITIONS.temperatureC.addresses),
        flowLpm: metricNumber(reading, METRIC_DEFINITIONS.flowLpm.aliases, METRIC_DEFINITIONS.flowLpm.names, METRIC_DEFINITIONS.flowLpm.addresses),
        voltageV: metricNumber(reading, METRIC_DEFINITIONS.voltageV.aliases, METRIC_DEFINITIONS.voltageV.names, METRIC_DEFINITIONS.voltageV.addresses),
        powerW: metricNumber(reading, METRIC_DEFINITIONS.powerW.aliases, METRIC_DEFINITIONS.powerW.names, METRIC_DEFINITIONS.powerW.addresses),
        energyKwh: metricNumber(reading, METRIC_DEFINITIONS.energyKwh.aliases, METRIC_DEFINITIONS.energyKwh.names, METRIC_DEFINITIONS.energyKwh.addresses),
        rssiDbm: metricNumber(reading, METRIC_DEFINITIONS.rssiDbm.aliases, METRIC_DEFINITIONS.rssiDbm.names, METRIC_DEFINITIONS.rssiDbm.addresses),
        signalQuality: metricNumber(reading, METRIC_DEFINITIONS.signalQuality.aliases, METRIC_DEFINITIONS.signalQuality.names, METRIC_DEFINITIONS.signalQuality.addresses),
        relayState: metricBoolean(reading, METRIC_DEFINITIONS.relayState.aliases, METRIC_DEFINITIONS.relayState.names, METRIC_DEFINITIONS.relayState.addresses),
        alarmState: metricBoolean(reading, METRIC_DEFINITIONS.alarmState.aliases, METRIC_DEFINITIONS.alarmState.names, METRIC_DEFINITIONS.alarmState.addresses),
        decodedCount,
        status: reading.parsingStatus,
        decodedStatus: reading.decodedValues?.status ?? "no_registers",
        parsingStatus: reading.parsingStatus,
        decodedRegisters,
      };
    });
  }, [rawReadings]);

  const latestByDevice = useMemo(() => {
    const map = new Map<string, ParsedReading>();
    parsedData.forEach((reading) => map.set(reading.deviceId, reading));
    return map;
  }, [parsedData]);

  const stringRuntime = useMemo<StringRuntime[]>(() => {
    void nowTick;
    return siteBlueprint.strings.map((string) => ({
      string,
      ...evaluateStringStatus(string, latestByDevice.get(string.deviceId) ?? null, stalenessThresholdMinutes),
    }));
  }, [latestByDevice, siteBlueprint, stalenessThresholdMinutes, nowTick]);

  const minutesSinceLatest = useMemo(() => {
    void nowTick;
    if (!latestByDevice.size) return null;
    const newest = Math.max(
      ...Array.from(latestByDevice.values()).map((reading) => new Date(reading.receivedAt).getTime()),
    );
    if (!Number.isFinite(newest)) return null;
    return Math.max(0, Math.round((Date.now() - newest) / 60_000));
  }, [latestByDevice, nowTick]);

  const previousTokenDevices = useMemo(() => {
    void nowTick;
    const now = Date.now();
    return Array.from(latestByDevice.entries())
      .filter(([, reading]) => reading.tokenSlot === "previous")
      .map(([deviceId, reading]) => ({
        deviceId,
        lastSeen: reading.receivedAt,
        minutesAgo: Math.max(0, Math.round((now - new Date(reading.receivedAt).getTime()) / 60_000)),
      }))
      .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  }, [latestByDevice, nowTick]);

  const staleDevices = useMemo(() => {
    void nowTick;
    const now = Date.now();
    return Array.from(latestByDevice.entries())
      .map(([deviceId, reading]) => ({
        deviceId,
        minutes: Math.max(0, Math.round((now - new Date(reading.receivedAt).getTime()) / 60_000)),
      }))
      .filter((entry) => entry.minutes > stalenessThresholdMinutes)
      .sort((a, b) => b.minutes - a.minutes);
  }, [latestByDevice, stalenessThresholdMinutes, nowTick]);

  const latest = parsedData.at(-1) ?? null;
  const previous = parsedData.slice(0, -1);
  const latestReceivedDate = latest ? new Date(latest.receivedAt) : null;
  const validLatestReceivedDate = latestReceivedDate && !Number.isNaN(latestReceivedDate.getTime()) ? latestReceivedDate : null;
  const lastReceivedDisplay = validLatestReceivedDate
    ? `${formatDistanceToNow(validLatestReceivedDate, { addSuffix: true })} (${format(validLatestReceivedDate, "MMM dd, yyyy HH:mm:ss")})`
    : "No readings yet";
  const latestIsStale = minutesSinceLatest !== null && minutesSinceLatest > stalenessThresholdMinutes;
  const avgTemp = previous.filter((item) => item.temperatureC !== null).reduce((acc, item, _, array) => acc + (item.temperatureC ?? 0) / array.length, 0);
  const tempDiff = latest?.temperatureC !== null && latest?.temperatureC !== undefined && avgTemp ? latest.temperatureC - avgTemp : 0;
  const latestPower = latest?.powerW ?? 0;
  const avgPower = previous.filter((item) => item.powerW !== null).reduce((acc, item, _, array) => acc + (item.powerW ?? 0) / array.length, 0);
  const powerDiff = latestPower && avgPower ? latestPower - avgPower : 0;
  const latestSignal = latest?.signalQuality ?? 0;
  const decodedRatio = latest && latest.decodedCount > 0 ? `${latest.decodedCount} registers` : formatStatus(latest?.decodedStatus ?? "no_registers");
  const chartData = parsedData.map((reading) => ({
    ...reading,
    relayStateNumeric: reading.relayState === null ? null : reading.relayState ? 1 : 0,
    alarmStateNumeric: reading.alarmState === null ? null : reading.alarmState ? 1 : 0,
  }));
  const hasMetricHistory = parsedData.some((reading) =>
    [reading.temperatureC, reading.flowLpm, reading.voltageV, reading.powerW, reading.energyKwh, reading.rssiDbm, reading.signalQuality].some((value) => value !== null),
  );
  const hasDigitalHistory = parsedData.some((reading) => reading.relayState !== null || reading.alarmState !== null);
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e7eb";
  const tickColor = isDark ? "#a1a1aa" : "#64748b";
  const activeFaults = stringRuntime.filter((item) => item.status === "fault").length;
  const activeWarnings = stringRuntime.filter((item) => item.status === "warning").length;
  const operationalStrings = stringRuntime.filter((item) => item.status === "online").length;

  const columns: ColumnDef<ParsedReading>[] = [
    { accessorKey: "id", header: "ID", cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span> },
    { accessorKey: "deviceId", header: "Device", cell: ({ row }) => <span className="font-medium">{row.original.deviceId}</span> },
    { accessorKey: "receivedAt", header: "Received", cell: ({ row }) => <span>{safeFormatDate(row.original.receivedAt, "MMM dd, yyyy HH:mm:ss")}</span> },
    { accessorKey: "temperatureC", header: "Temp (°C)", cell: ({ row }) => <span>{formatMetric(row.original.temperatureC)}</span> },
    { accessorKey: "flowLpm", header: "Flow (L/min)", cell: ({ row }) => <span>{formatMetric(row.original.flowLpm, 2)}</span> },
    { accessorKey: "voltageV", header: "Voltage (V)", cell: ({ row }) => <span>{formatMetric(row.original.voltageV, 2)}</span> },
    { accessorKey: "relayState", header: "Relay", cell: ({ row }) => <span>{formatBoolean(row.original.relayState)}</span> },
    { accessorKey: "alarmState", header: "Alarm", cell: ({ row }) => <span>{row.original.alarmState === true ? "Alarm" : row.original.alarmState === false ? "Normal" : "--"}</span> },
    { accessorKey: "decodedStatus", header: "Decoded", cell: ({ row }) => <Badge variant="outline" className="capitalize">{formatStatus(row.original.decodedStatus)}</Badge> },
  ];

  const lastRefreshed = dataUpdatedAt ? format(new Date(dataUpdatedAt), "MMM dd, HH:mm:ss") : "waiting for data";

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[280px_1fr]">
        <aside className="hidden border-r bg-card/70 px-5 py-6 lg:block">
          <div className="mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <div className="font-bold tracking-tight">SolarNexus</div>
                <div className="text-xs text-muted-foreground">by Automystics</div>
              </div>
            </div>
          </div>
          <nav className="space-y-1 text-sm">
            {[
              { id: "overview", label: "Overview", Icon: LayoutDashboard, adminOnly: false },
              { id: "simulation", label: "Plant Simulation", Icon: Network, adminOnly: false },
              { id: "single-line", label: "Single-Line Diagram", Icon: Workflow, adminOnly: false },
              { id: "formulae", label: "Formulae", Icon: Calculator, adminOnly: false },
              { id: "analytics", label: "Telemetry Analytics", Icon: BarChart3, adminOnly: false },
              { id: "report", label: "Reports", Icon: FileText, adminOnly: false },
              { id: "alerts", label: "Alerts", Icon: Bell, adminOnly: false },
              { id: "config", label: "Site Configuration", Icon: Settings, adminOnly: false },
              { id: "sites", label: "Sites", Icon: Building2, adminOnly: true },
              { id: "users", label: "Users", Icon: UsersIcon, adminOnly: true },
            ]
              .filter((item) => !item.adminOnly || isSuperAdmin)
              .map(({ id, label, Icon }) => {
                const isActive = activeView === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveView(id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                location.startsWith("/settings")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              data-testid="nav-settings"
            >
              <Settings className="h-4 w-4" />
              Organization settings
            </button>
          </nav>

          <div className="mt-6 rounded-xl border bg-background p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Signed in as</div>
            <div className="mt-2 font-semibold" data-testid="signed-in-name">{sessionUser?.name ?? currentUser?.name ?? "—"}</div>
            <div className="text-xs text-muted-foreground" data-testid="signed-in-email">{sessionUser?.email ?? currentUser?.email ?? ""}</div>
            <Badge className="mt-2" variant={(sessionUser?.role ?? currentUser?.role) === "super-admin" ? "default" : "outline"} data-testid="signed-in-role">
              {sessionUser?.role ?? currentUser?.role ?? "—"}
            </Badge>
          </div>

          <div className="mt-4 rounded-xl border bg-background p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Active Site</div>
            {visibleSites.length === 0 ? (
              <div className="mt-2 text-sm text-muted-foreground">No sites assigned. Ask a super admin for access.</div>
            ) : (
              <>
                <select
                  className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={currentSiteId}
                  onChange={(event) => setCurrentSiteId(event.target.value)}
                >
                  {visibleSites.map((site) => (
                    <option key={site.id} value={site.id}>{site.siteName}</option>
                  ))}
                </select>
                <div className="mt-3 text-sm text-muted-foreground">{siteBlueprint.location}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-muted p-2">
                    <div className="text-muted-foreground">Capacity</div>
                    <div className="font-semibold">{siteBlueprint.capacityMw} MW</div>
                  </div>
                  <div className="rounded-lg bg-muted p-2">
                    <div className="text-muted-foreground">Strings</div>
                    <div className="font-semibold">{siteBlueprint.strings.length}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
        <main className="min-w-0 px-4 py-5 md:px-7 lg:px-8">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">SolarNexus</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Blueprint-driven simulation, live string status tracking, and Modbus telemetry reporting.
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <SplitRefreshButton
                onRefresh={() => queryClient.invalidateQueries({ queryKey: getListModbusReadingsQueryKey(queryParams) })}
                loading={loading}
                isSpinning={isSpinning}
                isDark={isDark}
                autoRefreshInterval={autoRefreshInterval}
                setAutoRefreshInterval={setAutoRefreshInterval}
              />
              <AlertsBell onOpen={() => setActiveView("alerts")} />
              <Button
                variant="outline"
                size="sm"
                asChild
                title="Download the Agent_relay Windows desktop client (.zip)"
              >
                <a
                  href={`${import.meta.env.BASE_URL}api/downloads/agent-relay`}
                  download
                  data-testid="link-download-agent-relay"
                >
                  <Download className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">Windows client</span>
                </a>
              </Button>
              <Button variant="outline" size="icon" onClick={() => window.print()} aria-label="Export as PDF">
                <Printer className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setIsDark((value) => !value)} aria-label="Toggle dark mode">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  clearSession();
                  window.location.assign(`${import.meta.env.BASE_URL}login`);
                }}
                aria-label="Sign out"
                title={(() => {
                  const u = getStoredUser();
                  return u ? `Signed in as ${u.email} — sign out` : "Sign out";
                })()}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <div className="space-y-5">
            {activeView === "overview" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="border-l-4 border-l-emerald-500">
                <CardContent className="px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Live strings</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="kpi-live">{operationalStrings}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">operational right now</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-amber-500">
                <CardContent className="px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Warnings</p>
                  <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="kpi-warnings">{activeWarnings}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">active warning{activeWarnings === 1 ? "" : "s"}</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-red-500">
                <CardContent className="px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Faults</p>
                  <p className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400" data-testid="kpi-faults">{activeFaults}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">device{activeFaults === 1 ? "" : "s"} faulted</p>
                </CardContent>
              </Card>
              <Card className={`border-l-4 ${latestIsStale ? "border-l-amber-500" : "border-l-sky-500"}`}>
                <CardContent className="px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Last reading</p>
                  <p className={`mt-1 text-base font-semibold ${latestIsStale ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`} data-testid="kpi-last-reading">
                    {lastReceivedDisplay}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {latestIsStale ? `stale (>${stalenessThresholdMinutes} min)` : `refreshed ${lastRefreshed}`}
                  </p>
                </CardContent>
              </Card>
            </div>
            )}

            {(["overview", "simulation", "analytics", "report"].includes(activeView)) && (
            <Card className="print:hidden">
              <CardContent className="flex flex-wrap items-end gap-4 px-5 py-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="device-filter" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Device
                  </label>
                  <select
                    id="device-filter"
                    className="h-9 min-w-[200px] rounded-md border bg-background px-2 text-sm"
                    value={deviceFilter}
                    onChange={(event) => setDeviceFilter(event.target.value)}
                  >
                    <option value="all">All devices ({knownDeviceIds.length})</option>
                    {knownDeviceIds.map((id) => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Time range</span>
                  <div className="flex flex-wrap gap-1 rounded-md border bg-background p-1">
                    {([
                      { id: "hour", label: "Last hour" },
                      { id: "day", label: "Last 24h" },
                      { id: "week", label: "Last week" },
                      { id: "all", label: "All time" },
                      { id: "custom", label: "Custom" },
                    ] as const).map((option) => (
                      <Button
                        key={option.id}
                        type="button"
                        variant={rangeFilter === option.id ? "default" : "ghost"}
                        size="sm"
                        onClick={() => {
                          if (option.id === "custom" && rangeFilter !== "custom" && !customStart && !customEnd) {
                            const now = new Date();
                            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
                            const toLocalInput = (date: Date) => {
                              const offsetMs = date.getTimezoneOffset() * 60_000;
                              return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
                            };
                            setCustomStart(toLocalInput(oneHourAgo));
                            setCustomEnd(toLocalInput(now));
                          }
                          setRangeFilter(option.id);
                        }}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  {rangeFilter === "custom" && (
                    <div className="mt-2 flex flex-wrap items-end gap-3 rounded-md border bg-background p-3">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="custom-start" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Start
                        </label>
                        <input
                          id="custom-start"
                          type="datetime-local"
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={customStart}
                          onChange={(event) => setCustomStart(event.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="custom-end" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          End
                        </label>
                        <input
                          id="custom-end"
                          type="datetime-local"
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={customEnd}
                          onChange={(event) => setCustomEnd(event.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCustomStart("");
                          setCustomEnd("");
                        }}
                      >
                        Clear
                      </Button>
                      <div className="basis-full">
                        {customRangeError ? (
                          <p className="text-xs text-destructive">{customRangeError}</p>
                        ) : customRangeNotice ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400">{customRangeNotice}</p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">Times use your local timezone. Leave one side blank for an open-ended window.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="ml-auto text-xs text-muted-foreground">
                  Showing <span className="font-semibold text-foreground">{parsedData.length}</span> reading{parsedData.length === 1 ? "" : "s"}
                  {deviceFilter !== "all" ? <> for <span className="font-mono text-foreground">{deviceFilter}</span></> : null}
                  {rangeFilter === "hour" ? <> in the last hour</> : null}
                  {rangeFilter === "day" ? <> in the last 24 hours</> : null}
                  {rangeFilter === "week" ? <> in the last week</> : null}
                  {rangeFilter === "custom" && !customRangeError ? (
                    <>
                      {" "}between{" "}
                      <span className="font-mono text-foreground">{customStartDate ? format(customStartDate, "MMM dd, yyyy HH:mm") : "the beginning"}</span>
                      {" "}and{" "}
                      <span className="font-mono text-foreground">{customEndDate ? format(customEndDate, "MMM dd, yyyy HH:mm") : "now"}</span>
                    </>
                  ) : null}
                  {rangeFilter === "custom" && customRangeError ? <> — custom range invalid, showing nothing</> : null}
                  .
                </div>
              </CardContent>
            </Card>
            )}

            {activeView === "alerts" && (
            <Card className="print:hidden">
              <CardContent className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      Alert thresholds
                      {currentSite ? <span className="ml-2 text-xs font-normal text-muted-foreground">· {siteBlueprint.siteName}</span> : null}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Control when this site warns about silent devices and how often repeat alerts are sent.
                    </p>
                  </div>
                  {siteHasThresholdOverride ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Custom override
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Using defaults
                    </span>
                  )}
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="staleness-threshold" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Warn when stale after
                    </label>
                    <select
                      id="staleness-threshold"
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={stalenessThresholdMinutes}
                      disabled={!currentSite}
                      onChange={(event) => {
                        void setStalenessThresholdMinutes(Number(event.target.value));
                      }}
                    >
                      {[5, 15, 30, 60, 120, 240, 1440].map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes < 60 ? `${minutes} min` : minutes === 1440 ? "24 hours" : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`}
                          {minutes === DEFAULT_STALENESS_THRESHOLD ? " (default)" : ""}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-muted-foreground">Device is marked faulted at 3× this value.</span>
                    {thresholdSaveError ? (
                      <span className="text-[11px] text-destructive">{thresholdSaveError}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="staleness-cooldown" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Resend cooldown
                    </label>
                    <select
                      id="staleness-cooldown"
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={cooldownMinutesValue}
                      disabled={!currentSite}
                      onChange={(event) => {
                        void setCooldownMinutes(Number(event.target.value));
                      }}
                    >
                      {[5, 15, 30, 60, 120, 240, 1440].map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes < 60 ? `${minutes} min` : minutes === 1440 ? "24 hours" : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`}
                          {minutes === DEFAULT_COOLDOWN_MINUTES ? " (default)" : ""}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-muted-foreground">Minimum wait between repeat alerts for the same device.</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            )}

            {isError && (
              <Card className="border-destructive/40">
                <CardContent className="flex items-start gap-3 px-6 py-5">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div>
                    <h2 className="font-semibold text-foreground">Unable to load Modbus readings</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : "The readings API returned an error."}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {!loading && previousTokenDevices.length > 0 && (
              <Card className="border-amber-500/50 bg-amber-500/5">
                <CardContent className="flex items-start gap-3 px-6 py-5">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-foreground">
                      {previousTokenDevices.length === 1 ? "1 device" : `${previousTokenDevices.length} devices`} still on the previous device token
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Each device's most recent reading was authenticated by a token in <span className="font-mono">MODBUS_INGEST_TOKEN_PREVIOUS</span>. Migrate these devices to the current <span className="font-mono">MODBUS_INGEST_TOKEN</span> before retiring the previous token.
                    </p>
                    <ul className="mt-3 space-y-1 text-sm">
                      {previousTokenDevices.slice(0, 5).map((entry) => (
                        <li key={entry.deviceId} className="flex items-center justify-between gap-3 rounded-md bg-background/60 px-3 py-1.5">
                          <span className="font-mono text-xs">{entry.deviceId}</span>
                          <span className="text-xs text-amber-700 dark:text-amber-300">
                            previous token used {entry.minutesAgo} min ago
                          </span>
                        </li>
                      ))}
                      {previousTokenDevices.length > 5 && (
                        <li className="text-xs text-muted-foreground">…and {previousTokenDevices.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}

            {!loading && staleDevices.length > 0 && (
              <Card className="border-amber-500/50 bg-amber-500/5">
                <CardContent className="flex items-start gap-3 px-6 py-5">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-foreground">
                      {staleDevices.length === 1 ? "1 device" : `${staleDevices.length} devices`} stopped sending data
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      No payloads received within the configured staleness threshold of {stalenessThresholdMinutes} minute{stalenessThresholdMinutes === 1 ? "" : "s"}. Adjust the threshold above if this is expected.
                    </p>
                    <ul className="mt-3 space-y-1 text-sm">
                      {staleDevices.slice(0, 5).map((entry) => (
                        <li key={entry.deviceId} className="flex items-center justify-between gap-3 rounded-md bg-background/60 px-3 py-1.5">
                          <span className="font-mono text-xs">{entry.deviceId}</span>
                          <span className="text-xs text-amber-700 dark:text-amber-300">
                            silent for {entry.minutes} min
                          </span>
                        </li>
                      ))}
                      {staleDevices.length > 5 && (
                        <li className="text-xs text-muted-foreground">…and {staleDevices.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeView === "overview" && (
            <div className="space-y-5">
              {!loading && !isError && parsedData.length === 0 ? (
                <EmptyState />
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <KPICard title="Latest Temperature" value={latest?.temperatureC === null || latest?.temperatureC === undefined ? "--" : `${latest.temperatureC.toFixed(1)} °C`} change={`${Math.abs(tempDiff).toFixed(1)} °C`} trend={tempDiff > 1 ? "up" : tempDiff < -1 ? "down" : "neutral"} loading={loading} valueColor={latest?.temperatureC !== null && latest?.temperatureC !== undefined && latest.temperatureC > 60 ? CHART_COLORS.red : CHART_COLORS.amber} />
                    <KPICard title="Latest Flow" value={latest?.flowLpm === null || latest?.flowLpm === undefined ? "--" : `${latest.flowLpm.toFixed(2)} L/min`} loading={loading} valueColor={CHART_COLORS.blue} />
                    <KPICard title="Latest Voltage" value={latest?.voltageV === null || latest?.voltageV === undefined ? "--" : `${latest.voltageV.toFixed(2)} V`} loading={loading} valueColor={CHART_COLORS.purple} />
                    <KPICard title="Decoded Values" value={decodedRatio} loading={loading} valueColor={latest?.decodedCount ? CHART_COLORS.green : CHART_COLORS.slate} />
                  </div>
                  <PlantSimulation blueprint={siteBlueprint} strings={stringRuntime} loading={loading} latest={latest} />
                </>
              )}
            </div>
            )}

            {activeView === "simulation" && (
              <PlantSimulation blueprint={siteBlueprint} strings={stringRuntime} loading={loading} latest={latest} />
            )}

            {activeView === "single-line" && (
              <SingleLineDiagram blueprint={siteBlueprint} strings={stringRuntime} loading={loading} />
            )}

            {activeView === "formulae" && (
              <FormulaeView blueprint={siteBlueprint} strings={stringRuntime} />
            )}

            {activeView === "analytics" && (
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-2">
                {loading ? (
                  <>
                    <Card><CardContent className="p-5"><Skeleton className="h-[300px] w-full" /></CardContent></Card>
                    <Card><CardContent className="p-5"><Skeleton className="h-[300px] w-full" /></CardContent></Card>
                  </>
                ) : hasMetricHistory ? (
                  <>
                    <Card>
                      <CardHeader className="flex-row items-center justify-between">
                        <CardTitle>Temperature & Flow Trend</CardTitle>
                        <CSVLink data={parsedData} filename="trb246-temperature-flow.csv" className="print:hidden"><Download className="h-4 w-4" /></CSVLink>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <AreaChart data={chartData}>
                            <defs>
                              <linearGradient id="temperatureFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={CHART_COLORS.amber} stopOpacity={0.45} />
                                <stop offset="100%" stopColor={CHART_COLORS.amber} stopOpacity={0.03} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                            <XAxis dataKey="timeLabel" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                            <YAxis yAxisId="left" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend content={<CustomLegend />} />
                            <Area yAxisId="left" type="monotone" dataKey="temperatureC" name="Temp (°C)" fill="url(#temperatureFill)" stroke={CHART_COLORS.amber} strokeWidth={2} />
                            <Line yAxisId="right" type="monotone" dataKey="flowLpm" name="Flow (L/min)" stroke={CHART_COLORS.blue} strokeWidth={2} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="flex-row items-center justify-between">
                        <CardTitle>Voltage, Power & Signal</CardTitle>
                        <CSVLink data={parsedData} filename="trb246-voltage-power-signal.csv" className="print:hidden"><Download className="h-4 w-4" /></CSVLink>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                            <XAxis dataKey="timeLabel" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                            <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend content={<CustomLegend />} />
                            <Line type="monotone" dataKey="voltageV" name="Voltage (V)" stroke={CHART_COLORS.purple} strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="powerW" name="Power (W)" stroke={CHART_COLORS.blue} strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="signalQuality" name="Signal (%)" stroke={CHART_COLORS.green} strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                    {hasDigitalHistory && (
                      <Card className="xl:col-span-2">
                        <CardHeader><CardTitle>Relay & Alarm State History</CardTitle></CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                              <XAxis dataKey="timeLabel" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                              <YAxis domain={[0, 1]} ticks={[0, 1]} tickFormatter={(value) => (value === 1 ? "On" : "Off")} tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                              <Tooltip content={<CustomTooltip />} />
                              <Legend content={<CustomLegend />} />
                              <Bar dataKey="relayStateNumeric" name="Relay" fill={CHART_COLORS.amber} />
                              <Bar dataKey="alarmStateNumeric" name="Alarm" fill={CHART_COLORS.red} />
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>
                    )}
                  </>
                ) : (
                  <NoDecodedValuesState />
                )}
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Telemetry History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {loading ? <Skeleton className="h-[360px] w-full" /> : <DataTable data={[...parsedData].reverse()} columns={columns} searchPlaceholder="Search device, status, or timestamp..." />}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Device Status</CardTitle></CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="space-y-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-4 w-full" />)}</div>
                    ) : latest ? (
                      <ul className="space-y-3 text-sm">
                        <li className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /><span>Latest reading from <strong>{latest.deviceId}</strong> was received {lastReceivedDisplay}.</span></li>
                        <li className="flex items-start gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>Decoded status is <strong className="capitalize">{formatStatus(latest.decodedStatus)}</strong> with {latest.decodedCount} decoded register{latest.decodedCount === 1 ? "" : "s"}.</span></li>
                        <li className="flex items-start gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>Relay is <strong>{formatBoolean(latest.relayState)}</strong>; alarm state is <strong>{latest.alarmState === true ? "Alarm" : latest.alarmState === false ? "Normal" : "--"}</strong>.</span></li>
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No device readings are available yet.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
            )}

            {activeView === "report" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportReportPdf({ blueprint: siteBlueprint, strings: stringRuntime, latest, operationalStrings, activeFaults, activeWarnings, lastReceivedDisplay, latestPower, latestSignal })}
                >
                  <FileText className="mr-2 h-4 w-4" /> Export PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportReportExcel({ blueprint: siteBlueprint, strings: stringRuntime, latest, operationalStrings, activeFaults, activeWarnings, lastReceivedDisplay, latestPower, latestSignal })}
                >
                  <Download className="mr-2 h-4 w-4" /> Export Excel
                </Button>
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Executive Operations Report</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    {loading ? (
                      <div className="space-y-3">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-4 w-full" />)}</div>
                    ) : (
                      <>
                        <p><strong>{operationalStrings}</strong> of <strong>{stringRuntime.length}</strong> configured strings are currently green. <strong>{activeFaults}</strong> strings require attention and <strong>{activeWarnings}</strong> are in warning state.</p>
                        <p>The live simulation maps incoming TRB246 readings to configured plant strings. Healthy telemetry renders green, weak or missing telemetry renders red, and uncertain decoded register states render amber.</p>
                        <p>Latest gateway snapshot: {latest?.deviceId ?? "no device"} received {lastReceivedDisplay}, at {latest?.temperatureC?.toFixed(1) ?? "--"} °C, {latestPower.toFixed(1)} W, and {latestSignal}% signal quality.</p>
                      </>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Recommended Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="rounded-lg border p-3"><div className="font-semibold">Replace placeholder blueprint with client CAD/site map</div><p className="mt-1 text-muted-foreground">The simulation is already configuration-driven, so each string can be positioned to match the actual plant.</p></div>
                    <div className="rounded-lg border p-3"><div className="font-semibold">Map each string to a confirmed register source</div><p className="mt-1 text-muted-foreground">Use decoded registers for voltage, flow/current, relay, and alarm state once final addresses are confirmed.</p></div>
                    <div className="rounded-lg border p-3"><div className="font-semibold">Enable alerting for red zones</div><p className="mt-1 text-muted-foreground">Faults should trigger operator notifications when a string stops reporting or output drops below threshold.</p></div>
                  </CardContent>
                </Card>
              </div>
            </div>
            )}

            {activeView === "alerts" && (
              <AlertsPanel
                sites={visibleSites.map((s) => ({
                  id: s.id,
                  siteName: s.siteName,
                }))}
              />
            )}

            {activeView === "config" && (
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-primary" /> Blueprint Configuration</CardTitle>
                  <p className="text-sm text-muted-foreground">Edit the live site layout. Changes are saved to this browser and reflected immediately on the simulation.</p>
                </CardHeader>
              </Card>
              {currentSite ? (
                <BlueprintEditor blueprint={siteBlueprint} setBlueprint={setBlueprint} resetBlueprint={resetBlueprint} />
              ) : (
                <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a site to edit its layout.</CardContent></Card>
              )}
              <Card>
                <CardHeader><CardTitle>Live String Status</CardTitle></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {stringRuntime.map((item) => (
                    <div key={item.string.id} className="rounded-xl border p-4" style={{ borderColor: item.color }}>
                      <div className="flex items-center justify-between gap-3"><div className="font-semibold">{item.string.name}</div><Badge style={{ backgroundColor: item.color, color: "white" }}>{item.statusLabel}</Badge></div>
                      <div className="mt-2 text-sm text-muted-foreground">{item.string.deviceId} • {item.string.mppt}</div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-lg bg-muted p-2"><div className="text-muted-foreground">Expected</div><div className="font-semibold">{item.string.expectedPowerW} W</div></div>
                        <div className="rounded-lg bg-muted p-2"><div className="text-muted-foreground">Live</div><div className="font-semibold">{item.powerW === null ? "--" : `${item.powerW.toFixed(1)} W`}</div></div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
            )}

            {activeView === "sites" && isSuperAdmin && (
              <SitesManager
                sites={sites}
                currentSiteId={currentSiteId}
                setCurrentSiteId={setCurrentSiteId}
                addSite={addSite}
                updateSite={updateSite}
                deleteSite={deleteSite}
              />
            )}

            {activeView === "users" && isSuperAdmin && (
              <UsersManager
                users={users}
                sites={sites}
                currentUserId={currentUserId}
                addUser={addUser}
                updateUser={updateUser}
                deleteUser={deleteUser}
              />
            )}

            {(activeView === "sites" || activeView === "users") && !isSuperAdmin && (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">You need super admin access to view this page.</CardContent></Card>
            )}

            {activeView === "settings" && <OrgSettingsPage />}
          </div>
        </main>
      </div>
    </div>
  );
}

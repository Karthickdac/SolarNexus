import { useEffect, useMemo, useState } from "react";
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
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  LayoutDashboard,
  Moon,
  Network,
  Printer,
  Settings,
  Sun,
  Users as UsersIcon,
  Zap,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  getListModbusReadingsQueryKey,
  useListModbusReadings,
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

function PlantSimulation({ blueprint, strings, loading }: { blueprint: SiteBlueprint; strings: StringRuntime[]; loading: boolean }) {
  const siteBlueprint = blueprint;
  const online = strings.filter((item) => item.status === "online").length;
  const warning = strings.filter((item) => item.status === "warning").length;
  const fault = strings.filter((item) => item.status === "fault").length;
  const health = strings.length ? Math.round((online / strings.length) * 100) : 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Network className="h-5 w-5 text-primary" />
            Site Blueprint Simulation
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {siteBlueprint.siteName} • {siteBlueprint.capacityMw} MW • layout driven from site configuration
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="bg-green-600 text-white">{online} online</Badge>
          <Badge className="bg-amber-500 text-white">{warning} warning</Badge>
          <Badge className="bg-red-600 text-white">{fault} fault</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[520px] w-full rounded-xl" />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[1fr_330px]">
            <div className="relative min-h-[520px] overflow-hidden rounded-2xl border bg-[radial-gradient(circle_at_top_left,rgba(255,153,0,0.16),transparent_28%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)))]">
              <div className="absolute inset-0 opacity-[0.28]" style={{ backgroundImage: "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
              {siteBlueprint.zones.map((zone) => (
                <div
                  key={zone.id}
                  className="absolute rounded-xl border border-border/80 bg-background/60 p-3 backdrop-blur-sm"
                  style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%` }}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{zone.name}</div>
                </div>
              ))}
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                {siteBlueprint.strings.map((string) => {
                  const inverter = siteBlueprint.inverters.find((item) => item.id === string.inverterId);
                  if (!inverter) return null;
                  const runtime = strings.find((item) => item.string.id === string.id);
                  return (
                    <line
                      key={string.id}
                      x1={`${string.x + 2}%`}
                      y1={`${string.y + 2}%`}
                      x2={`${inverter.x + 2}%`}
                      y2={`${inverter.y + 2}%`}
                      stroke={runtime?.color ?? CHART_COLORS.slate}
                      strokeWidth="2"
                      strokeDasharray={runtime?.status === "fault" ? "6 5" : "0"}
                      opacity="0.62"
                    />
                  );
                })}
                <line x1="70%" y1="46%" x2="82%" y2="62%" stroke={CHART_COLORS.blue} strokeWidth="3" opacity="0.5" />
              </svg>
              {strings.map((item) => (
                <div
                  key={item.string.id}
                  className="absolute h-8 w-16 rounded-lg border px-2 py-1 text-[10px] font-semibold transition-transform hover:z-20 hover:scale-110"
                  title={`${item.string.name}: ${item.statusLabel}`}
                  style={{
                    left: `${item.string.x}%`,
                    top: `${item.string.y}%`,
                    borderColor: item.color,
                    backgroundColor: `${item.color}22`,
                    color: item.color,
                  }}
                >
                  <div className="truncate">{item.string.name.replace("String ", "")}</div>
                  <div className="text-[9px] opacity-80">{item.powerW === null ? "No data" : `${item.powerW.toFixed(1)} W`}</div>
                </div>
              ))}
              {siteBlueprint.inverters.map((inverter) => {
                const linkedStrings = strings.filter((item) => item.string.inverterId === inverter.id);
                const inverterStatus: StatusLevel = linkedStrings.some((item) => item.status === "fault")
                  ? "fault"
                  : linkedStrings.some((item) => item.status === "warning")
                    ? "warning"
                    : "online";
                const color = statusColor(inverterStatus);
                return (
                  <div
                    key={inverter.id}
                    className="absolute flex h-14 w-20 flex-col items-center justify-center rounded-xl border bg-card text-center text-[10px] font-bold"
                    style={{ left: `${inverter.x}%`, top: `${inverter.y}%`, borderColor: color, color }}
                  >
                    <Cpu className="mb-1 h-4 w-4" />
                    {inverter.name.replace("Inverter ", "INV ")}
                  </div>
                );
              })}
              <div className="absolute left-[82%] top-[20%] flex h-16 w-20 flex-col items-center justify-center rounded-xl border border-primary bg-card text-center text-[10px] font-bold text-primary">
                <Building2 className="mb-1 h-4 w-4" />
                SCADA
              </div>
              <div className="absolute left-[82%] top-[62%] flex h-16 w-20 flex-col items-center justify-center rounded-xl border border-blue-500 bg-card text-center text-[10px] font-bold text-blue-500">
                <Zap className="mb-1 h-4 w-4" />
                Grid
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
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [isDark, setIsDark] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [activeView, setActiveView] = useState("overview");

  const [deviceFilter, setDeviceFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter] = useState<"hour" | "day" | "week" | "all" | "custom">("all");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [stalenessThresholdMinutes, setStalenessThresholdMinutesState] = useState<number>(() => {
    if (typeof window === "undefined") return 30;
    const raw = window.localStorage.getItem("solarnexus.staleness-threshold-minutes.v1");
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  });
  const setStalenessThresholdMinutes = (value: number) => {
    setStalenessThresholdMinutesState(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("solarnexus.staleness-threshold-minutes.v1", String(value));
    }
  };

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
    { query: { enabled: queryEnabled, placeholderData: queryEnabled ? undefined : { readings: [] } } },
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
  const allowedSiteIds = currentUser?.role === "super-admin" ? ("all" as const) : (currentUser?.siteIds ?? []);
  const { sites, visibleSites, currentSite, currentSiteId, setCurrentSiteId, addSite, updateSite, deleteSite, setBlueprintForSite } =
    useSites(allowedSiteIds);
  const isSuperAdmin = currentUser?.role === "super-admin";

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

  const rawReadings = data?.readings ?? [];

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
          </nav>

          <div className="mt-6 rounded-xl border bg-background p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Signed in as</div>
            <div className="mt-2 font-semibold">{currentUser?.name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{currentUser?.email}</div>
            <Badge className="mt-2" variant={isSuperAdmin ? "default" : "outline"}>{currentUser?.role ?? "—"}</Badge>
            {users.length > 1 && (
              <select
                className="mt-3 h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={currentUserId}
                onChange={(event) => setCurrentUserId(event.target.value)}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name} ({user.role})</option>
                ))}
              </select>
            )}
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
          <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge className="bg-green-600 text-white">{operationalStrings} live strings</Badge>
                <Badge className="bg-amber-500 text-white">{activeWarnings} warnings</Badge>
                <Badge className="bg-red-600 text-white">{activeFaults} faults</Badge>
                <Badge variant="outline">App DB</Badge>
                <Badge variant="outline">Teltonika TRB246</Badge>
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">SolarNexus by Automystics</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Blueprint-driven simulation, live string status tracking, and Modbus telemetry reporting.
              </p>
              <p className={`mt-2 font-mono text-xs ${latestIsStale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                Last received: {lastReceivedDisplay}
                {latestIsStale ? ` — exceeds ${stalenessThresholdMinutes} min staleness threshold` : ""}
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">Dashboard refresh: {lastRefreshed}</p>
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
              <Button variant="outline" size="icon" onClick={() => window.print()} aria-label="Export as PDF">
                <Printer className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setIsDark((value) => !value)} aria-label="Toggle dark mode">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </header>

          <div className="space-y-5">
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
                <div className="flex flex-col gap-1">
                  <label htmlFor="staleness-threshold" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Warn when stale after
                  </label>
                  <select
                    id="staleness-threshold"
                    className="h-9 min-w-[160px] rounded-md border bg-background px-2 text-sm"
                    value={stalenessThresholdMinutes}
                    onChange={(event) => setStalenessThresholdMinutes(Number(event.target.value))}
                  >
                    {[5, 15, 30, 60, 120, 240, 1440].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes < 60 ? `${minutes} min` : minutes === 1440 ? "24 hours" : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-muted-foreground">Devices warn when no payload arrives for this long; faulted at 3×.</span>
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

            <div className="grid gap-2 rounded-xl border bg-card p-1 md:inline-grid md:grid-cols-6">
              {[
                { id: "overview", label: "Overview" },
                { id: "simulation", label: "Simulation" },
                { id: "analytics", label: "Analytics" },
                { id: "report", label: "Report" },
                { id: "alerts", label: "Alerts" },
                { id: "config", label: "Config" },
              ].map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant={activeView === item.id ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveView(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>

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
                  <PlantSimulation blueprint={siteBlueprint} strings={stringRuntime} loading={loading} />
                </>
              )}
            </div>
            )}

            {activeView === "simulation" && (
              <PlantSimulation blueprint={siteBlueprint} strings={stringRuntime} loading={loading} />
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
              <AlertsPanel />
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
          </div>
        </main>
      </div>
    </div>
  );
}

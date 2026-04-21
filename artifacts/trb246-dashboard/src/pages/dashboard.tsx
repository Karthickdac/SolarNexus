import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CSVLink } from "react-csv";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Area,
  AreaChart,
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
  BarChart3,
  Building2,
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
import { format } from "date-fns";
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

type ChartPayloadEntry = {
  color?: string;
  name?: string;
  value?: string | number | null;
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

type ModbusPayloadValues = {
  temperatureC?: unknown;
  voltageV?: unknown;
  currentA?: unknown;
  powerW?: unknown;
  energyKwh?: unknown;
  rssiDbm?: unknown;
  signalQuality?: unknown;
};

type ParsedReading = {
  id: number;
  deviceId: string;
  receivedAt: string;
  timeLabel: string;
  dateLabel: string;
  temperatureC: number | null;
  voltageV: number | null;
  currentA: number | null;
  powerW: number | null;
  energyKwh: number | null;
  rssiDbm: number | null;
  signalQuality: number | null;
  status: string;
  decodedStatus: string;
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

function getPayloadValues(rawPayload: ModbusReadingRawPayload): ModbusPayloadValues {
  return isRecord(rawPayload.values) ? rawPayload.values : {};
}

function getPayloadRegisters(rawPayload: ModbusReadingRawPayload): Record<string, unknown> {
  return isRecord(rawPayload.registers) ? rawPayload.registers : {};
}

function registerNumber(registers: ModbusDecodedRegister[], nameIncludes: string): number | null {
  const match = registers.find((register) => register.name.toLowerCase().includes(nameIncludes.toLowerCase()));
  return match ? numericValue(match.value) : null;
}

function statusColor(status: StatusLevel): string {
  if (status === "online") return CHART_COLORS.green;
  if (status === "warning") return CHART_COLORS.amber;
  return CHART_COLORS.red;
}

function evaluateStringStatus(string: BlueprintString, reading: ParsedReading | null): Omit<StringRuntime, "string"> {
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
  const stale = minutesSinceData > 30;
  const weakSignal = signalQuality !== null && signalQuality < 60;
  const lowPower = powerW !== null && powerW < string.expectedPowerW * 0.35;

  if (stale || decodedHasInvalid || weakSignal || lowPower) {
    return {
      reading,
      status: "fault",
      statusLabel: stale ? "Stale data" : weakSignal ? "Weak signal" : lowPower ? "Low output" : "Invalid register",
      color: CHART_COLORS.red,
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

  const queryParams = { limit: 100 };
  const { data, isLoading, isFetching, dataUpdatedAt } = useListModbusReadings(queryParams);
  const loading = isLoading || isFetching;

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
  }, [autoRefreshInterval, queryClient]);

  const rawReadings = data?.readings ?? [];

  const parsedData = useMemo<ParsedReading[]>(() => {
    return [...rawReadings].reverse().map((reading: ModbusReading) => {
      const values = getPayloadValues(reading.rawPayload);
      const registers = getPayloadRegisters(reading.rawPayload);
      const decodedRegisters = reading.decodedValues?.registers ?? [];
      const registerTemperature = numericValue(registers["30001"]);
      const registerVoltage = numericValue(registers["30002"]);
      const registerCurrent = numericValue(registers["30003"]);
      const decodedTemperature = registerNumber(decodedRegisters, "temperature");
      const decodedVoltage = registerNumber(decodedRegisters, "voltage");

      return {
        id: reading.id,
        deviceId: reading.deviceId,
        receivedAt: reading.receivedAt,
        timeLabel: format(new Date(reading.receivedAt), "HH:mm"),
        dateLabel: format(new Date(reading.receivedAt), "MMM dd, HH:mm"),
        temperatureC: numericValue(values.temperatureC) ?? decodedTemperature ?? (registerTemperature === null ? null : registerTemperature / 10),
        voltageV: numericValue(values.voltageV) ?? decodedVoltage ?? (registerVoltage === null ? null : registerVoltage / 100),
        currentA: numericValue(values.currentA) ?? (registerCurrent === null ? null : registerCurrent / 1000),
        powerW: numericValue(values.powerW) ?? numericValue(registers["30004"]),
        energyKwh: numericValue(values.energyKwh),
        rssiDbm: numericValue(values.rssiDbm) ?? numericValue(registers["30100"]),
        signalQuality: numericValue(values.signalQuality) ?? numericValue(registers["30101"]),
        status: reading.parsingStatus,
        decodedStatus: reading.decodedValues?.status ?? "no_registers",
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
    return siteBlueprint.strings.map((string) => ({
      string,
      ...evaluateStringStatus(string, latestByDevice.get(string.deviceId) ?? null),
    }));
  }, [latestByDevice, siteBlueprint]);

  const latest = parsedData.at(-1) ?? null;
  const previous = parsedData.slice(0, -1);
  const avgTemp = previous.reduce((acc, item) => acc + (item.temperatureC ?? 0), 0) / (previous.length || 1);
  const tempDiff = latest?.temperatureC && avgTemp ? latest.temperatureC - avgTemp : 0;
  const latestPower = latest?.powerW ?? 0;
  const avgPower = previous.reduce((acc, item) => acc + (item.powerW ?? 0), 0) / (previous.length || 1);
  const powerDiff = latestPower && avgPower ? latestPower - avgPower : 0;
  const latestSignal = latest?.signalQuality ?? 0;
  const totalEnergy = latest?.energyKwh ?? 0;
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e7eb";
  const tickColor = isDark ? "#a1a1aa" : "#64748b";
  const activeFaults = stringRuntime.filter((item) => item.status === "fault").length;
  const activeWarnings = stringRuntime.filter((item) => item.status === "warning").length;
  const operationalStrings = stringRuntime.filter((item) => item.status === "online").length;

  const columns: ColumnDef<ParsedReading>[] = [
    { accessorKey: "id", header: "ID", cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span> },
    { accessorKey: "deviceId", header: "Device", cell: ({ row }) => <span className="font-medium">{row.original.deviceId}</span> },
    { accessorKey: "receivedAt", header: "Timestamp", cell: ({ row }) => <span>{format(new Date(row.original.receivedAt), "MMM dd, yyyy HH:mm:ss")}</span> },
    { accessorKey: "temperatureC", header: "Temp", cell: ({ row }) => <span>{row.original.temperatureC?.toFixed(1) ?? "--"} °C</span> },
    { accessorKey: "powerW", header: "Power", cell: ({ row }) => <span className="font-semibold">{row.original.powerW?.toFixed(1) ?? "--"} W</span> },
    { accessorKey: "signalQuality", header: "Signal", cell: ({ row }) => <span>{row.original.signalQuality ?? "--"}%</span> },
    { accessorKey: "decodedStatus", header: "Decode", cell: ({ row }) => <Badge variant="outline">{row.original.decodedStatus}</Badge> },
  ];

  const lastRefreshed = dataUpdatedAt
    ? `${new Date(dataUpdatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase()} on ${new Date(dataUpdatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "waiting for data";

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
                <div className="font-bold tracking-tight">PlantOS</div>
                <div className="text-xs text-muted-foreground">TRB246 Operations</div>
              </div>
            </div>
          </div>
          <nav className="space-y-1 text-sm">
            {[
              { id: "overview", label: "Overview", Icon: LayoutDashboard, adminOnly: false },
              { id: "simulation", label: "Plant Simulation", Icon: Network, adminOnly: false },
              { id: "analytics", label: "Telemetry Analytics", Icon: BarChart3, adminOnly: false },
              { id: "report", label: "Reports", Icon: FileText, adminOnly: false },
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
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Enterprise Power Plant Console</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Blueprint-driven simulation, live string status tracking, and Modbus telemetry reporting.
              </p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">Last refresh: {lastRefreshed}</p>
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
              <Button variant="outline" size="icon" onClick={() => window.print()} aria-label="Export as PDF">
                <Printer className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setIsDark((value) => !value)} aria-label="Toggle dark mode">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </header>

          <div className="space-y-5">
            <div className="grid gap-2 rounded-xl border bg-card p-1 md:inline-grid md:grid-cols-5">
              {[
                { id: "overview", label: "Overview" },
                { id: "simulation", label: "Simulation" },
                { id: "analytics", label: "Analytics" },
                { id: "report", label: "Report" },
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
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <KPICard title="Gateway Temperature" value={latest?.temperatureC ? `${latest.temperatureC.toFixed(1)} °C` : "--"} change={`${Math.abs(tempDiff).toFixed(1)} °C`} trend={tempDiff > 1 ? "up" : tempDiff < -1 ? "down" : "neutral"} loading={loading} valueColor={latest?.temperatureC && latest.temperatureC > 60 ? CHART_COLORS.red : CHART_COLORS.amber} />
                <KPICard title="Current Power Draw" value={latestPower ? `${latestPower.toFixed(1)} W` : "--"} change={`${Math.abs(powerDiff).toFixed(1)} W`} trend={powerDiff > 5 ? "up" : powerDiff < -5 ? "down" : "neutral"} loading={loading} valueColor={CHART_COLORS.blue} />
                <KPICard title="Signal Quality" value={latestSignal ? `${latestSignal}%` : "--"} loading={loading} valueColor={latestSignal > 70 ? CHART_COLORS.green : latestSignal < 60 ? CHART_COLORS.red : CHART_COLORS.amber} />
                <KPICard title="Total Energy Delivered" value={totalEnergy ? `${totalEnergy.toFixed(2)} kWh` : "--"} loading={loading} valueColor={CHART_COLORS.cyan} />
              </div>
              <PlantSimulation blueprint={siteBlueprint} strings={stringRuntime} loading={loading} />
            </div>
            )}

            {activeView === "simulation" && (
              <PlantSimulation blueprint={siteBlueprint} strings={stringRuntime} loading={loading} />
            )}

            {activeView === "analytics" && (
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-2">
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>Temperature and Energy Trend</CardTitle>
                    {!loading && <CSVLink data={parsedData} filename="temperature-energy.csv"><Download className="h-4 w-4" /></CSVLink>}
                  </CardHeader>
                  <CardContent>
                    {loading ? <Skeleton className="h-[300px] w-full" /> : (
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={parsedData}>
                          <defs>
                            <linearGradient id="temperatureFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={CHART_COLORS.amber} stopOpacity={0.45} />
                              <stop offset="100%" stopColor={CHART_COLORS.amber} stopOpacity={0.03} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                          <XAxis dataKey="timeLabel" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                          <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                          <Tooltip content={<CustomTooltip />} />
                          <Legend content={<CustomLegend />} />
                          <Area type="monotone" dataKey="temperatureC" name="Temperature °C" fill="url(#temperatureFill)" stroke={CHART_COLORS.amber} strokeWidth={2} />
                          <Line type="monotone" dataKey="energyKwh" name="Energy kWh" stroke={CHART_COLORS.cyan} strokeWidth={2} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>Power, Voltage and Signal</CardTitle>
                    {!loading && <CSVLink data={parsedData} filename="power-voltage-signal.csv"><Download className="h-4 w-4" /></CSVLink>}
                  </CardHeader>
                  <CardContent>
                    {loading ? <Skeleton className="h-[300px] w-full" /> : (
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={parsedData}>
                          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                          <XAxis dataKey="timeLabel" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                          <YAxis yAxisId="left" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                          <Tooltip content={<CustomTooltip />} />
                          <Legend content={<CustomLegend />} />
                          <Line yAxisId="left" type="monotone" dataKey="powerW" name="Power W" stroke={CHART_COLORS.blue} strokeWidth={2} dot={false} />
                          <Line yAxisId="right" type="monotone" dataKey="voltageV" name="Voltage V" stroke={CHART_COLORS.purple} strokeWidth={2} dot={false} />
                          <Line yAxisId="right" type="monotone" dataKey="signalQuality" name="Signal %" stroke={CHART_COLORS.green} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Telemetry History</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? <Skeleton className="h-[360px] w-full" /> : <DataTable data={[...parsedData].reverse()} columns={columns} searchPlaceholder="Search device, status, or timestamp..." />}
                </CardContent>
              </Card>
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
                        <p>Latest gateway snapshot: {latest?.deviceId ?? "no device"} at {latest?.temperatureC?.toFixed(1) ?? "--"} °C, {latestPower.toFixed(1)} W, and {latestSignal}% signal quality.</p>
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

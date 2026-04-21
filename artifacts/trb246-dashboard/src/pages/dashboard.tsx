import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListModbusReadings, getListModbusReadingsQueryKey } from "@workspace/api-client-react";
import type { ModbusReadingRawPayload } from "@workspace/api-client-react";
import type { ColumnDef } from "@tanstack/react-table";
import { CSVLink } from "react-csv";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sun, Moon, Download, Printer } from "lucide-react";
import { format } from "date-fns";

import { KPICard } from "../components/kpi-card";
import { SplitRefreshButton } from "../components/split-refresh-button";
import { DataTable } from "../components/data-table";

// --- Constants & Colors ---

const CHART_COLORS = {
  primary: "#ff9900", // Industrial Orange
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  slate: "#4b5563",
};

const DATA_SOURCES: string[] = ["App DB", "Teltonika TRB246"];

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

// --- Tooltips & Legends ---

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        backgroundColor: "#fff",
        borderRadius: "6px",
        padding: "10px 14px",
        border: "1px solid #e0e0e0",
        color: "#1a1a1a",
        fontSize: "13px",
        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
      }}
    >
      <div style={{ marginBottom: "6px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
        {label}
      </div>
      {payload.map((entry, index) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
          {entry.color && entry.color !== "#ffffff" && (
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", backgroundColor: entry.color, flexShrink: 0 }} />
          )}
          <span style={{ color: "#444" }}>{entry.name}</span>
          <span style={{ marginLeft: "auto", fontWeight: 600 }}>
            {typeof entry.value === "number" ? Number.isInteger(entry.value) ? entry.value : entry.value.toFixed(2) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend({ payload }: LegendProps) {
  if (!payload || payload.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 16px", fontSize: "13px", paddingTop: "10px" }}>
      {payload.map((entry, index) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", backgroundColor: entry.color, flexShrink: 0 }} />
          <span className="text-muted-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [isDark, setIsDark] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);

  const queryParams = { limit: 100 };
  const { data, isLoading, isFetching, dataUpdatedAt } = useListModbusReadings(queryParams);

  const loading = isLoading || isFetching;

  // --- Dark Mode Sync ---
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // --- Spinning Animation Polish ---
  useEffect(() => {
    if (loading) {
      setIsSpinning(true);
      return undefined;
    } else {
      const t = setTimeout(() => setIsSpinning(false), 600);
      return () => clearTimeout(t);
    }
  }, [loading]);

  // --- Auto Refresh Logic ---
  useEffect(() => {
    if (autoRefreshInterval <= 0) return undefined;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getListModbusReadingsQueryKey(queryParams) });
    }, autoRefreshInterval);
    return () => clearInterval(interval);
  }, [autoRefreshInterval, queryClient]);

  // --- Data Parsing & Transformation ---
  const rawReadings = data?.readings || [];
  
  const parsedData = useMemo<ParsedReading[]>(() => {
    return [...rawReadings].reverse().map(r => {
      const values = getPayloadValues(r.rawPayload);
      const registers = getPayloadRegisters(r.rawPayload);
      const registerTemperature = numericValue(registers["30001"]);
      const registerVoltage = numericValue(registers["30002"]);
      const registerCurrent = numericValue(registers["30003"]);
      
      return {
        id: r.id,
        deviceId: r.deviceId,
        receivedAt: r.receivedAt,
        timeLabel: format(new Date(r.receivedAt), "HH:mm:ss"),
        dateLabel: format(new Date(r.receivedAt), "MMM dd, HH:mm"),
        temperatureC: numericValue(values.temperatureC) ?? (registerTemperature === null ? null : registerTemperature / 10),
        voltageV: numericValue(values.voltageV) ?? (registerVoltage === null ? null : registerVoltage / 100),
        currentA: numericValue(values.currentA) ?? (registerCurrent === null ? null : registerCurrent / 1000),
        powerW: numericValue(values.powerW) ?? numericValue(registers["30004"]),
        energyKwh: numericValue(values.energyKwh),
        rssiDbm: numericValue(values.rssiDbm) ?? numericValue(registers["30100"]),
        signalQuality: numericValue(values.signalQuality) ?? numericValue(registers["30101"]),
        status: r.parsingStatus,
      };
    });
  }, [rawReadings]);

  // --- Derived KPIs ---
  const latest = parsedData.length > 0 ? parsedData[parsedData.length - 1] : null;
  const previous = parsedData.length > 1 ? parsedData.slice(0, -1) : [];
  
  const avgTemp = previous.reduce((acc, d) => acc + (d.temperatureC || 0), 0) / (previous.length || 1);
  const tempDiff = latest?.temperatureC && avgTemp ? latest.temperatureC - avgTemp : 0;
  
  const latestPower = latest?.powerW || 0;
  const avgPower = previous.reduce((acc, d) => acc + (d.powerW || 0), 0) / (previous.length || 1);
  const powerDiff = latestPower && avgPower ? latestPower - avgPower : 0;

  const latestSignal = latest?.signalQuality || 0;

  const totalEnergy = latest?.energyKwh || 0;

  // --- Timestamps ---
  const lastRefreshed = dataUpdatedAt
    ? (() => {
        const d = new Date(dataUpdatedAt);
        return `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase()} on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      })()
    : null;

  // --- Chart Colors based on theme ---
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  // --- Table Columns ---
  const columns: ColumnDef<ParsedReading>[] = [
    { accessorKey: "id", header: "ID", cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span> },
    { accessorKey: "deviceId", header: "Device", cell: ({ row }) => <span className="font-medium text-sm">{row.original.deviceId}</span> },
    { accessorKey: "receivedAt", header: "Timestamp", cell: ({ row }) => <span className="text-sm">{format(new Date(row.original.receivedAt), "MMM dd, yyyy HH:mm:ss")}</span> },
    { accessorKey: "temperatureC", header: "Temp (°C)", cell: ({ row }) => <span className="text-sm">{row.original.temperatureC?.toFixed(1) || "--"}</span> },
    { accessorKey: "voltageV", header: "Voltage (V)", cell: ({ row }) => <span className="text-sm">{row.original.voltageV?.toFixed(1) || "--"}</span> },
    { accessorKey: "powerW", header: "Power (W)", cell: ({ row }) => <span className="text-sm font-semibold">{row.original.powerW?.toFixed(1) || "--"}</span> },
    { accessorKey: "signalQuality", header: "Signal (%)", cell: ({ row }) => <span className="text-sm">{row.original.signalQuality || "--"}</span> },
  ];

  return (
    <div className="min-h-screen bg-background px-5 py-4 pt-[32px] pb-[32px] pl-[24px] pr-[24px]">
      <div className="max-w-[1400px] mx-auto">

        {/* ── Header ── */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="pt-2">
            <h1 className="font-bold text-[32px] text-foreground tracking-tight">Telemetry Console</h1>
            <p className="text-muted-foreground mt-1.5 text-[14px]">Live TRB246 Gateway Monitoring & Analysis</p>
            
            {DATA_SOURCES.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[12px] text-muted-foreground shrink-0">Data Sources:</span>
                {DATA_SOURCES.map((source) => (
                  <span
                    key={source}
                    className="text-[12px] font-bold rounded px-2 py-0.5 truncate print:!bg-[rgb(229,231,235)] print:!text-[rgb(75,85,99)]"
                    title={source}
                    style={{
                      maxWidth: "20ch",
                      backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgb(229, 231, 235)",
                      color: isDark ? "#c8c9cc" : "rgb(75, 85, 99)",
                    }}
                  >
                    {source}
                  </span>
                ))}
              </div>
            )}
            
            {lastRefreshed && <p className="text-[12px] text-muted-foreground mt-2 font-mono">Last refresh: {lastRefreshed}</p>}
          </div>
          
          <div className="flex items-center gap-3 pt-2 print:hidden">
            <SplitRefreshButton 
              onRefresh={() => queryClient.invalidateQueries({ queryKey: getListModbusReadingsQueryKey(queryParams) })}
              loading={loading}
              isSpinning={isSpinning}
              isDark={isDark}
              autoRefreshInterval={autoRefreshInterval}
              setAutoRefreshInterval={setAutoRefreshInterval}
            />
            <button
              onClick={() => window.print()}
              className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors"
              style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
              aria-label="Export as PDF"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsDark((d) => !d)}
              className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors"
              style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
              aria-label="Toggle dark mode"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* ── KPI Row ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KPICard 
            title="Gateway Temperature" 
            value={latest?.temperatureC ? `${latest.temperatureC.toFixed(1)} °C` : "--"} 
            change={Math.abs(tempDiff).toFixed(1) + " °C"}
            trend={tempDiff > 1 ? "up" : tempDiff < -1 ? "down" : "neutral"}
            loading={loading}
            valueColor={latest?.temperatureC && latest.temperatureC > 60 ? CHART_COLORS.red : CHART_COLORS.primary}
          />
          <KPICard 
            title="Current Power Draw" 
            value={latestPower ? `${latestPower.toFixed(1)} W` : "--"} 
            change={Math.abs(powerDiff).toFixed(1) + " W"}
            trend={powerDiff > 5 ? "up" : powerDiff < -5 ? "down" : "neutral"}
            loading={loading}
            valueColor={CHART_COLORS.primary}
          />
          <KPICard 
            title="Signal Quality" 
            value={latestSignal ? `${latestSignal}%` : "--"} 
            loading={loading}
            valueColor={latestSignal > 70 ? CHART_COLORS.green : latestSignal < 30 ? CHART_COLORS.red : CHART_COLORS.primary}
          />
          <KPICard 
            title="Total Energy Delivered" 
            value={totalEnergy ? `${totalEnergy.toFixed(2)} kWh` : "--"} 
            loading={loading}
            valueColor={CHART_COLORS.blue}
          />
        </div>

        {/* ── Charts Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader className="px-5 pt-5 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-semibold">Temperature & Energy Trend</CardTitle>
              {!loading && parsedData.length > 0 && (
                <CSVLink data={parsedData} filename="temp-energy-trend.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {loading ? <Skeleton className="w-full h-[300px]" /> : (
                <ResponsiveContainer width="100%" height={300} debounce={0}>
                  <AreaChart data={parsedData}>
                    <defs>
                      <linearGradient id="gradientTemp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="timeLabel" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} tickMargin={8} />
                    <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => `${v}°C`} />
                    <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} />
                    <Legend content={<CustomLegend />} />
                    <Area type="monotone" dataKey="temperatureC" name="Temp (°C)" fill="url(#gradientTemp)" stroke={CHART_COLORS.primary} fillOpacity={1} strokeWidth={2} activeDot={{ r: 5, fill: CHART_COLORS.primary, stroke: '#ffffff', strokeWidth: 3 }} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-5 pt-5 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-semibold">Power & Voltage</CardTitle>
              {!loading && parsedData.length > 0 && (
                <CSVLink data={parsedData} filename="power-voltage.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {loading ? <Skeleton className="w-full h-[300px]" /> : (
                <ResponsiveContainer width="100%" height={300} debounce={0}>
                  <LineChart data={parsedData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="timeLabel" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} tickMargin={8} />
                    <YAxis yAxisId="left" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                    <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={{ stroke: tickColor, strokeDasharray: '3 3' }} />
                    <Legend content={<CustomLegend />} />
                    <Line yAxisId="left" type="monotone" dataKey="powerW" name="Power (W)" stroke={CHART_COLORS.blue} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: CHART_COLORS.blue, stroke: '#ffffff', strokeWidth: 3 }} isAnimationActive={false} />
                    <Line yAxisId="right" type="step" dataKey="voltageV" name="Voltage (V)" stroke={CHART_COLORS.purple} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: CHART_COLORS.purple, stroke: '#ffffff', strokeWidth: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          
          <Card className="lg:col-span-2">
            <CardHeader className="px-5 pt-5 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-semibold">Signal Quality (RSSI & Quality %)</CardTitle>
              {!loading && parsedData.length > 0 && (
                <CSVLink data={parsedData} filename="signal-quality.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {loading ? <Skeleton className="w-full h-[250px]" /> : (
                <ResponsiveContainer width="100%" height={250} debounce={0}>
                  <LineChart data={parsedData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="timeLabel" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} tickMargin={8} />
                    <YAxis yAxisId="left" domain={[0, 100]} tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                    <YAxis yAxisId="right" orientation="right" domain={[-120, -30]} tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                    <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={{ stroke: tickColor, strokeDasharray: '3 3' }} />
                    <Legend content={<CustomLegend />} />
                    <Line yAxisId="left" type="monotone" dataKey="signalQuality" name="Signal (%)" stroke={CHART_COLORS.green} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: CHART_COLORS.green, stroke: '#ffffff', strokeWidth: 3 }} isAnimationActive={false} />
                    <Line yAxisId="right" type="monotone" dataKey="rssiDbm" name="RSSI (dBm)" stroke={CHART_COLORS.slate} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: CHART_COLORS.slate, stroke: '#ffffff', strokeWidth: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Analytical Report Section ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="lg:col-span-2">
            <CardHeader className="px-6 pt-6 pb-2">
              <CardTitle className="text-lg">Executive Summary</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {loading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
                </div>
              ) : (
                <ul className="space-y-3 text-sm text-foreground">
                  <li className="flex items-start gap-3">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span className="leading-relaxed">Telemetry feed is operating nominally. Latest snapshot shows <strong>{latest?.deviceId}</strong> operating at {latest?.temperatureC}°C, drawing {latestPower}W of power.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span className="leading-relaxed">Signal quality averages around {latestSignal}%. Fluctuations in RSSI observed but connection remains stable above critical threshold.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span className="leading-relaxed">Energy consumption is tracking consistently with historical operational parameters, totaling {totalEnergy.toFixed(2)} kWh.</span>
                  </li>
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-6 pt-6 pb-2">
              <CardTitle className="text-lg">Recommendations</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {loading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
                </div>
              ) : (
                <ol className="space-y-4 text-sm text-foreground list-decimal list-inside">
                  <li className="leading-relaxed"><strong>Monitor Temperature</strong>: Operating at {latest?.temperatureC}°C. Ensure ambient cooling remains active to prevent thermal throttling.</li>
                  <li className="leading-relaxed"><strong>Check Antenna Placement</strong>: If signal quality dips below 40%, inspect the physical antenna orientation.</li>
                  <li className="leading-relaxed"><strong>Review Payload Rate</strong>: Ensure polling frequency aligns with your data budget and real-time operational needs.</li>
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Recent History Data Table ── */}
        <Card className="mb-6">
          <CardHeader className="px-5 pt-5 pb-2">
            <CardTitle className="text-base font-semibold">Raw Telemetry Log</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full mb-4" />
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <DataTable data={parsedData} columns={columns} searchPlaceholder="Filter by device ID or value..." />
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

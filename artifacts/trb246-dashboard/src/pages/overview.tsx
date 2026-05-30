import { useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Activity, Gauge, Zap, Waves, Percent, Sigma } from "lucide-react";
import {
  useListModbusReadings,
  getListModbusReadingsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MetricCard,
  ChartTooltip,
  METRIC_COLORS,
  PageHeader,
  StatusDot,
} from "@/components/telemetry";
import {
  PRIMARY_DEVICE_ID,
  parseReading,
  minutesSince,
  formatPower,
  formatNumber,
  type ParsedReading,
} from "@/lib/readings";

const QUERY_PARAMS = { limit: 100, deviceId: PRIMARY_DEVICE_ID };

export default function OverviewPage() {
  const { data, isLoading } = useListModbusReadings(QUERY_PARAMS, {
    query: {
      queryKey: getListModbusReadingsQueryKey(QUERY_PARAMS),
      refetchInterval: 15_000,
    },
  });

  const readings = useMemo<ParsedReading[]>(
    () => (data?.readings ?? []).map(parseReading),
    [data],
  );

  // readings come newest-first; chronological for charts
  const chrono = useMemo(() => [...readings].reverse(), [readings]);
  const latest = readings[0] ?? null;

  const trend = useMemo(
    () =>
      chrono.map((r) => ({
        time: format(new Date(r.receivedAt), "HH:mm:ss"),
        power: r.powerW === null ? null : r.powerW / 1000,
        voltage: r.voltageV,
      })),
    [chrono],
  );

  const mins = latest ? minutesSince(latest.receivedAt) : null;
  const tone = mins === null ? "down" : mins <= 15 ? "ok" : mins <= 120 ? "warn" : "down";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live overview"
        description="Real-time electrical telemetry from the TRB246 gateway."
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <StatusDot tone={tone} />
            <div>
              <div className="text-sm font-semibold text-foreground">
                {PRIMARY_DEVICE_ID}
              </div>
              <div className="text-xs text-muted-foreground">
                {latest
                  ? `Last reading ${formatDistanceToNow(new Date(latest.receivedAt), { addSuffix: true })}`
                  : "Awaiting data"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Snapshots </span>
              <span className="font-mono font-medium text-foreground">
                {isLoading ? "--" : readings.length}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Decoded registers </span>
              <span className="font-mono font-medium text-foreground">
                {latest ? latest.decodedCount : "--"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Status </span>
              <span className="font-medium capitalize text-foreground">
                {latest ? latest.decodedStatus.replace(/_/g, " ") : "--"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Active power"
          value={latest ? formatNumber(latest.powerW === null ? null : latest.powerW / 1000, 1) : "--"}
          unit="kW"
          accent={METRIC_COLORS.power}
          icon={<Zap className="h-4 w-4" />}
          loading={isLoading}
          sub={latest ? formatPower(latest.powerW) : undefined}
        />
        <MetricCard
          label="Voltage"
          value={latest ? formatNumber(latest.voltageV, 1) : "--"}
          unit="V"
          accent={METRIC_COLORS.voltage}
          icon={<Activity className="h-4 w-4" />}
          loading={isLoading}
          sub={
            latest && latest.voltageA !== null
              ? `A ${formatNumber(latest.voltageA, 0)} · B ${formatNumber(latest.voltageB, 0)} · C ${formatNumber(latest.voltageC, 0)}`
              : undefined
          }
        />
        <MetricCard
          label="Current"
          value={latest ? formatNumber(latest.currentA, 1) : "--"}
          unit="A"
          accent={METRIC_COLORS.current}
          icon={<Waves className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Frequency"
          value={latest ? formatNumber(latest.frequencyHz, 2) : "--"}
          unit="Hz"
          accent={METRIC_COLORS.frequency}
          icon={<Gauge className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Power factor"
          value={latest ? formatNumber(latest.powerFactor, 3) : "--"}
          accent={METRIC_COLORS.powerFactor}
          icon={<Percent className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Reactive power"
          value={latest ? formatNumber(latest.reactiveVar, 0) : "--"}
          unit="var"
          accent={METRIC_COLORS.reactive}
          icon={<Sigma className="h-4 w-4" />}
          loading={isLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            Active power trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : trend.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              No readings available for this device.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={288}>
              <AreaChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="powerFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={METRIC_COLORS.power} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={METRIC_COLORS.power} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  unit=" kW"
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="power"
                  name="Power"
                  unit="kW"
                  stroke={METRIC_COLORS.power}
                  strokeWidth={2}
                  fill="url(#powerFill)"
                  connectNulls
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

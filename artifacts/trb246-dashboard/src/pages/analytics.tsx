import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  useListModbusReadings,
  getListModbusReadingsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader, ChartTooltip, METRIC_COLORS } from "@/components/telemetry";
import {
  PRIMARY_DEVICE_ID,
  parseReading,
  type ParsedReading,
} from "@/lib/readings";

const LIMITS = [
  { label: "Last 25", value: 25 },
  { label: "Last 50", value: 50 },
  { label: "Last 100", value: 100 },
];

type ChartPoint = {
  time: string;
  power: number | null;
  voltageA: number | null;
  voltageB: number | null;
  voltageC: number | null;
  current: number | null;
  frequency: number | null;
  powerFactor: number | null;
};

const axis = {
  tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
  tickLine: false,
  axisLine: false,
} as const;

export default function AnalyticsPage() {
  const [limit, setLimit] = useState(100);
  const params = { limit, deviceId: PRIMARY_DEVICE_ID };
  const { data, isLoading } = useListModbusReadings(params, {
    query: { queryKey: getListModbusReadingsQueryKey(params) },
  });

  const points = useMemo<ChartPoint[]>(() => {
    const parsed: ParsedReading[] = (data?.readings ?? []).map(parseReading);
    return [...parsed].reverse().map((r) => ({
      time: format(new Date(r.receivedAt), "HH:mm:ss"),
      power: r.powerW === null ? null : r.powerW / 1000,
      voltageA: r.voltageA,
      voltageB: r.voltageB,
      voltageC: r.voltageC,
      current: r.currentA,
      frequency: r.frequencyHz,
      powerFactor: r.powerFactor,
    }));
  }, [data]);

  const empty = !isLoading && points.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Historical electrical telemetry over the captured window."
        actions={
          <div className="flex rounded-md border bg-card p-0.5">
            {LIMITS.map((opt) => (
              <Button
                key={opt.value}
                variant={limit === opt.value ? "default" : "ghost"}
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => setLimit(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        }
      />

      {empty ? (
        <Card>
          <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No readings available for this device.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Active power (kW)</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={256}>
                  <AreaChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="aPower" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={METRIC_COLORS.power} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={METRIC_COLORS.power} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" {...axis} minTickGap={40} />
                    <YAxis {...axis} width={44} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="power" name="Power" unit="kW" stroke={METRIC_COLORS.power} strokeWidth={2} fill="url(#aPower)" connectNulls dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Phase voltages (V)</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={256}>
                  <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" {...axis} minTickGap={40} />
                    <YAxis {...axis} width={48} domain={["auto", "auto"]} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="voltageA" name="Phase A" unit="V" stroke={METRIC_COLORS.voltage} strokeWidth={1.75} dot={false} connectNulls />
                    <Line type="monotone" dataKey="voltageB" name="Phase B" unit="V" stroke={METRIC_COLORS.current} strokeWidth={1.75} dot={false} connectNulls />
                    <Line type="monotone" dataKey="voltageC" name="Phase C" unit="V" stroke={METRIC_COLORS.powerFactor} strokeWidth={1.75} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Current (A)</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={256}>
                  <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" {...axis} minTickGap={40} />
                    <YAxis {...axis} width={44} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="current" name="Current" unit="A" stroke={METRIC_COLORS.current} strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Frequency &amp; power factor</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={256}>
                  <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" {...axis} minTickGap={40} />
                    <YAxis yAxisId="hz" {...axis} width={44} domain={["auto", "auto"]} />
                    <YAxis yAxisId="pf" orientation="right" {...axis} width={44} domain={[0, 1]} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="hz" type="monotone" dataKey="frequency" name="Frequency" unit="Hz" stroke={METRIC_COLORS.frequency} strokeWidth={2} dot={false} connectNulls />
                    <Line yAxisId="pf" type="monotone" dataKey="powerFactor" name="Power factor" stroke={METRIC_COLORS.powerFactor} strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import {
  useListModbusReadings,
  getListModbusReadingsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/telemetry";
import {
  PRIMARY_DEVICE_ID,
  RAW_DEVICE_ID,
  parseReading,
  formatNumber,
  type ParsedReading,
} from "@/lib/readings";

const DEVICE_OPTIONS = [
  { label: "Primary (trb246)", value: PRIMARY_DEVICE_ID },
  { label: "Raw fragments", value: RAW_DEVICE_ID },
  { label: "All devices", value: "all" },
];

const LIMITS = [25, 50, 100];

function statusTone(status: string): string {
  if (status === "ok" || status === "all_registers_decoded") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (status.includes("invalid")) return "bg-red-500/15 text-red-600 dark:text-red-400";
  if (status.includes("no") || status === "unknown") return "bg-muted text-muted-foreground";
  return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
}

export default function ReadingsPage() {
  const [device, setDevice] = useState<string>(PRIMARY_DEVICE_ID);
  const [limit, setLimit] = useState(50);

  const params = useMemo(
    () => ({
      limit,
      ...(device === "all" ? {} : { deviceId: device }),
    }),
    [device, limit],
  );

  const { data, isLoading } = useListModbusReadings(params, {
    query: { queryKey: getListModbusReadingsQueryKey(params) },
  });

  const rows = useMemo<ParsedReading[]>(
    () => (data?.readings ?? []).map(parseReading),
    [data],
  );

  const columns = useMemo<ColumnDef<ParsedReading>[]>(
    () => [
      {
        accessorKey: "receivedAt",
        header: "Time",
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
            {format(new Date(row.original.receivedAt), "MMM d, HH:mm:ss")}
          </span>
        ),
      },
      {
        accessorKey: "deviceId",
        header: "Device",
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.deviceId}</span>
        ),
      },
      {
        id: "power",
        header: "Power",
        accessorFn: (r) => r.powerW,
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {row.original.powerW === null
              ? "--"
              : `${(row.original.powerW / 1000).toFixed(1)} kW`}
          </span>
        ),
      },
      {
        id: "voltage",
        header: "Voltage",
        accessorFn: (r) => r.voltageV,
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatNumber(row.original.voltageV, 1, " V")}
          </span>
        ),
      },
      {
        id: "current",
        header: "Current",
        accessorFn: (r) => r.currentA,
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatNumber(row.original.currentA, 1, " A")}
          </span>
        ),
      },
      {
        id: "frequency",
        header: "Freq",
        accessorFn: (r) => r.frequencyHz,
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatNumber(row.original.frequencyHz, 2, " Hz")}
          </span>
        ),
      },
      {
        id: "pf",
        header: "PF",
        accessorFn: (r) => r.powerFactor,
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatNumber(row.original.powerFactor, 3)}
          </span>
        ),
      },
      {
        accessorKey: "decodedStatus",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant="secondary"
            className={`border-0 font-normal ${statusTone(row.original.decodedStatus)}`}
          >
            {row.original.decodedStatus.replace(/_/g, " ")}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Readings"
        description="Decoded Modbus snapshots captured from the gateway."
        actions={
          <div className="flex items-center gap-2">
            <Select value={device} onValueChange={setDevice}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEVICE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex rounded-md border bg-card p-0.5">
              {LIMITS.map((n) => (
                <Button
                  key={n}
                  variant={limit === n ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setLimit(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>
        }
      />

      <Card>
        <CardContent className="p-5">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              data={rows}
              columns={columns}
              searchPlaceholder="Search readings..."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

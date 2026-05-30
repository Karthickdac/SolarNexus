import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const METRIC_COLORS = {
  power: "hsl(var(--chart-1))",
  voltage: "hsl(var(--chart-2))",
  current: "hsl(var(--chart-3))",
  frequency: "hsl(var(--chart-4))",
  powerFactor: "hsl(var(--chart-5))",
  reactive: "hsl(215 16% 55%)",
} as const;

type MetricCardProps = {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: string;
  icon?: ReactNode;
  loading?: boolean;
};

export function MetricCard({
  label,
  value,
  unit,
  sub,
  accent = "hsl(var(--primary))",
  icon,
  loading,
}: MetricCardProps) {
  return (
    <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <CardContent className="p-5 pl-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {icon && (
            <span className="text-muted-foreground" style={{ color: accent }}>
              {icon}
            </span>
          )}
        </div>
        {loading ? (
          <Skeleton className="mt-3 h-8 w-28" />
        ) : (
          <p className="mt-2 flex items-baseline gap-1 font-mono">
            <span className="text-3xl font-semibold tabular-nums text-foreground">
              {value}
            </span>
            {unit && (
              <span className="text-sm font-medium text-muted-foreground">
                {unit}
              </span>
            )}
          </p>
        )}
        {sub && !loading && (
          <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

type ChartPayloadEntry = {
  color?: string;
  name?: string;
  value?: number | string;
  unit?: string;
};

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ChartPayloadEntry[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-medium text-foreground">{label}</div>
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div
            key={`${entry.name}-${index}`}
            className="flex items-center gap-2"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
              {typeof entry.value === "number"
                ? entry.value.toFixed(
                    Number.isInteger(entry.value) ? 0 : 2,
                  )
                : entry.value}
              {entry.unit ? ` ${entry.unit}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "down" }) {
  const color =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span
        className={cn(
          "absolute inline-flex h-full w-full rounded-full opacity-60",
          tone === "ok" && "animate-ping",
          color,
        )}
      />
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", color)} />
    </span>
  );
}

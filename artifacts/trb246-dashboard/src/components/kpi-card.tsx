import { Card, CardContent } from "@/components/ui/card";
import { ArrowUpIcon, ArrowDownIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface KPICardProps {
  title: string;
  value: string;
  change?: string;
  trend?: "up" | "down" | "neutral";
  loading: boolean;
  valueColor?: string; // Default to blue in use but can be customized for semantic mapping
}

export function KPICard({ title, value, change, trend, loading, valueColor = "#ff9900" }: KPICardProps) {
  const isPositive = trend === "up";
  const isNegative = trend === "down";

  return (
    <Card>
      <CardContent className="p-6">
        {loading ? (
          <>
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className="h-8 w-32" />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: valueColor }}>{value}</p>
            {change && trend && (
              <div className="flex items-center gap-1 mt-1">
                {isPositive && <ArrowUpIcon className="w-4 h-4 text-green-600 dark:text-green-400" />}
                {isNegative && <ArrowDownIcon className="w-4 h-4 text-red-600 dark:text-red-400" />}
                <span className={`text-sm ${
                  isPositive ? "text-green-600 dark:text-green-400" : 
                  isNegative ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                }`}>
                  {change}
                </span>
                <span className="text-sm text-muted-foreground">vs prev avg</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

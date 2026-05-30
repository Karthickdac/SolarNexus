import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  LayoutDashboard,
  LineChart,
  Table2,
  Bell,
  Settings,
  Sun,
  Moon,
  LogOut,
  Zap,
  Menu,
} from "lucide-react";
import {
  useListModbusReadings,
  getListModbusReadingsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearSession, getStoredUser } from "@/lib/auth";
import { PRIMARY_DEVICE_ID, minutesSince } from "@/lib/readings";
import { StatusDot } from "@/components/telemetry";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: LineChart },
  { href: "/readings", label: "Readings", icon: Table2 },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem("solarnexus.theme");
    if (stored) return stored === "dark";
    return document.documentElement.classList.contains("dark");
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      window.localStorage.setItem("solarnexus.theme", dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((v) => !v) };
}

function DeviceStatus() {
  const params = { limit: 1, deviceId: PRIMARY_DEVICE_ID };
  const { data } = useListModbusReadings(params, {
    query: {
      queryKey: getListModbusReadingsQueryKey(params),
      refetchInterval: 30_000,
    },
  });
  const latest = data?.readings?.[0];
  if (!latest) {
    return (
      <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <StatusDot tone="down" />
        <span>No device data</span>
      </div>
    );
  }
  const mins = minutesSince(latest.receivedAt);
  const tone = mins <= 15 ? "ok" : mins <= 120 ? "warn" : "down";
  return (
    <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs">
      <StatusDot tone={tone} />
      <span className="font-medium text-foreground">{PRIMARY_DEVICE_ID}</span>
      <span className="text-muted-foreground">
        {formatDistanceToNow(new Date(latest.receivedAt), { addSuffix: true })}
      </span>
    </div>
  );
}

function activeTitle(location: string): string {
  if (location.startsWith("/analytics")) return "Analytics";
  if (location.startsWith("/readings")) return "Readings";
  if (location.startsWith("/alerts")) return "Alerts";
  if (location.startsWith("/settings")) return "Settings";
  return "Overview";
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { dark, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = getStoredUser();

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  const handleLogout = () => {
    clearSession();
    navigate("/login", { replace: true });
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Zap className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-sidebar-foreground">
            SolarNexus
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            TRB246 Monitor
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="mb-2 px-2">
          <div className="truncate text-sm font-medium text-sidebar-foreground">
            {user?.name || user?.email || "Operator"}
          </div>
          {user?.email && (
            <div className="truncate text-xs text-muted-foreground">
              {user.email}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-60 border-r border-sidebar-border bg-sidebar">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-base font-semibold text-foreground">
            {activeTitle(location)}
          </h1>
          <div className="ml-auto flex items-center gap-3">
            <DeviceStatus />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

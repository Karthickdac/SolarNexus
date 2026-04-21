import { useState, useEffect, useRef } from "react";
import { RefreshCw, ChevronDown, Check } from "lucide-react";

interface SplitRefreshButtonProps {
  onRefresh: () => void;
  loading: boolean;
  isSpinning: boolean;
  isDark: boolean;
  autoRefreshInterval: number;
  setAutoRefreshInterval: (ms: number) => void;
}

const INTERVAL_OPTIONS = [
  { label: "Off", ms: 0 },
  { label: "Every 5 min", ms: 5 * 60 * 1000 },
  { label: "Every 15 min", ms: 15 * 60 * 1000 },
  { label: "Every 1 hour", ms: 60 * 60 * 1000 },
];

export function SplitRefreshButton({
  onRefresh,
  loading,
  isSpinning,
  isDark,
  autoRefreshInterval,
  setAutoRefreshInterval,
}: SplitRefreshButtonProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <div
        className="flex items-center rounded-[6px] overflow-hidden h-[26px] text-[12px]"
        style={{
          backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2",
          color: isDark ? "#c8c9cc" : "#4b5563",
        }}
      >
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 px-2 h-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
          aria-label="Refresh data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSpinning ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <div
          className="w-px h-4 shrink-0"
          style={{ backgroundColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)" }}
        />
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className="flex items-center justify-center px-1.5 h-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          aria-label="Auto-refresh settings"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {dropdownOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-48 rounded-md shadow-lg border bg-popover text-popover-foreground z-50 py-1"
        >
          <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Auto-refresh
          </div>
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={opt.ms}
              className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              onClick={() => {
                setAutoRefreshInterval(opt.ms);
                setDropdownOpen(false);
              }}
            >
              {opt.label}
              {autoRefreshInterval === opt.ms && <Check className="w-4 h-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

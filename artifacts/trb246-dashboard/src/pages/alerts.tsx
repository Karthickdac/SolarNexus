import { AlertsPanel } from "@/components/alerts-panel";
import { PageHeader } from "@/components/telemetry";

export default function AlertsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Device staleness alerts, notification channels, and thresholds."
      />
      <AlertsPanel />
    </div>
  );
}

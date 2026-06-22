import { formatDeviceAlertStatus } from "@/hooks/useHrAttendanceData";
import { formatBranchLabel } from "@/lib/attendanceTime";
import type { DeviceAlert } from "@/types/calendar";
import { AlertTriangleIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export function DeviceCloseoutBanner({ alerts }: { alerts: DeviceAlert[] }) {
  return (
    <Card className="border-brand-accent/40 bg-muted/25 animate-in fade-in">
      <CardContent className="flex gap-3 py-3">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-brand-accent" />
        <div className="min-w-0 space-y-2 text-sm">
          <div className="font-medium text-foreground">
            Device closeout pending ({alerts.length})
          </div>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {alerts.map((alert) => (
              <li key={`${alert.device_sn}-${alert.local_date}`} className="truncate">
                <span className="font-medium text-foreground">{alert.local_date}</span>
                {" · "}
                {alert.device_sn}
                {" · "}
                {formatDeviceAlertStatus(alert.status)}
                {alert.last_error ? ` — ${alert.last_error}` : null}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export function DeviceAlertRow({ alert }: { alert: DeviceAlert }) {
  return (
    <div className="rounded-lg border border-brand-accent/30 bg-muted/25 px-3 py-2 text-xs">
      <div className="font-medium text-foreground">{alert.device_sn}</div>
      <div className="mt-0.5 text-muted-foreground">
        {formatDeviceAlertStatus(alert.status)}
        {alert.branch ? ` · ${formatBranchLabel(alert.branch)}` : null}
      </div>
      {alert.last_error ? (
        <div className="mt-1 text-muted-foreground">{alert.last_error}</div>
      ) : null}
    </div>
  );
}

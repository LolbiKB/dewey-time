import { formatDeviceAlertStatus } from "@/hooks/useHrAttendanceData";
import { formatBranchLabel, formatDurationMinutes } from "@/lib/attendanceTime";
import type { DeviceAlert } from "@/types/calendar";
import { AlertTriangleIcon, ClockIcon } from "lucide-react";

import { AttentionStrip } from "@/components/ui/notice";

export function DeviceCloseoutBanner({ alerts }: { alerts: DeviceAlert[] }) {
  return (
    <AttentionStrip
      tone="accent"
      count={alerts.length}
      icon={<AlertTriangleIcon className="size-4 text-brand-accent" aria-hidden="true" />}
      detail={
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
      }
    >
      Device closeout pending
    </AttentionStrip>
  );
}

/**
 * Shown when no device punch has arrived for >3h. Surfaces a stalled Bridge
 * before the first UNNOTIFIED_ABSENCE flag appears.
 */
export function DeviceSyncStalenessBanner({ minutesSince }: { minutesSince: number }) {
  const ago = formatDurationMinutes(Math.round(minutesSince));
  return (
    <AttentionStrip
      tone="amber"
      icon={<ClockIcon className="size-4 text-amber-600" aria-hidden="true" />}
    >
      Device data may be stale — last sync <span className="font-medium">{ago}</span> ago
    </AttentionStrip>
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

import { formatDeviceAlertStatus } from "@/hooks/useHrAttendanceData";
import { formatBranchLabel, formatDurationMinutes } from "@/lib/attendanceTime";
import { cn } from "@/lib/utils";
import type { DeviceAlert } from "@/types/calendar";

/**
 * The attendance page's data-health popover body.
 *
 * Both banners this replaces rendered inside `Section grow`, directly above the
 * week view — so they took their height from the calendar rather than from the
 * page. Same facts, no layout cost.
 *
 * One amber tone for both. `DeviceCloseoutBanner` was tone="accent", the brand
 * orange src/brand/tokens.css reserves for the URGENT signal — but a pending
 * closeout is a data-freshness problem, not an urgent-action one, so merged
 * into one chip they share the staleness banner's amber. Deliberate.
 */
export function DeviceHealthDetail(props: {
  alerts: DeviceAlert[];
  /** Null when there is no staleness to report. */
  staleSyncMinutes: number | null;
}) {
  return (
    <div className="px-3 py-2.5 text-sm">
      {props.staleSyncMinutes != null ? (
        <p className="text-foreground">
          Device data may be stale — last sync{" "}
          <span className="font-medium">
            {formatDurationMinutes(props.staleSyncMinutes)}
          </span>{" "}
          ago
        </p>
      ) : null}
      {props.alerts.length > 0 ? (
        <ul
          className={cn(
            "space-y-1.5 text-xs text-muted-foreground",
            props.staleSyncMinutes != null && "mt-2 border-t border-border pt-2",
          )}
        >
          {props.alerts.map((alert) => (
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
      ) : null}
    </div>
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

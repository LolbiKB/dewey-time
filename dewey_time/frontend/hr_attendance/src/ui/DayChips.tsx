import type { Day, DeviceAlert, Flag } from "@/types/calendar";

import { AppTooltip } from "@/ui/AppTooltip";

export type DayChipsProps = {
  day?: Day;
  alerts?: DeviceAlert[];
  isClockDay?: boolean;
  onInspectFlag?: (flag: Flag) => void;
};

function offShiftPunchFlag(day?: Day): Flag | undefined {
  return (day?.flags ?? []).find((flag) => flag.flag_code === "OFF_SHIFT_PUNCH");
}

// Leave / off-shift / device-alert chips for one day. Shared by the desktop week
// grid header and the phone day-view header so the chip set cannot drift.
export function DayChips(props: DayChipsProps) {
  const onLeave = props.day?.leave?.on_leave;
  const offShiftFlag = offShiftPunchFlag(props.day);
  const hasAlert = (props.alerts ?? []).length > 0;

  if (!onLeave && !offShiftFlag && !hasAlert && !props.isClockDay) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {props.isClockDay ? (
        <AppTooltip content="Clock in/out — no schedule, no lateness rules" side="bottom">
          <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
            Clock
          </span>
        </AppTooltip>
      ) : null}
      {onLeave ? (
        <AppTooltip
          content={props.day?.leave?.leave_type ? `On leave · ${props.day.leave.leave_type}` : "On leave"}
          side="bottom"
        >
          <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
            Leave
          </span>
        </AppTooltip>
      ) : null}
      {offShiftFlag ? (
        <AppTooltip content="Review off-shift punch flag" side="bottom">
          <button
            type="button"
            onClick={() => props.onInspectFlag?.(offShiftFlag)}
            className="inline-flex max-w-full items-center rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive hover:bg-destructive/15"
          >
            OFF_SHIFT
          </button>
        </AppTooltip>
      ) : null}
      {hasAlert ? (
        <AppTooltip content="Device closeout pending" side="bottom">
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-brand-accent/40 bg-brand-accent/10 px-1 text-[10px] font-semibold text-brand-accent">
            !
          </span>
        </AppTooltip>
      ) : null}
    </div>
  );
}

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResolvePlanGroup } from "@/types/schedule";
import { formatDayList, formatTimeInput } from "@/types/schedule";

export type ResolvePlanGroupsListProps = {
  groups: ResolvePlanGroup[];
  className?: string;
  compact?: boolean;
};

/** Matched Shift Type / Shift Schedule groups — same as manual weekly schedule preview. */
export function ResolvePlanGroupsList(props: ResolvePlanGroupsListProps) {
  const { groups, compact = false } = props;

  if (!groups.length) return null;

  return (
    <ul className={cn("space-y-2", props.className)}>
      {groups.map((group, index) => {
        const shiftTypeName =
          group.shift_type.action === "use"
            ? group.shift_type.name
            : group.shift_type.proposed_name;
        const scheduleName =
          group.shift_schedule.action === "use"
            ? group.shift_schedule.name
            : group.shift_schedule.proposed_name;
        const typeCreating = group.shift_type.action === "create";
        const scheduleCreating = group.shift_schedule.action === "create";

        return (
          <li
            key={`${index}-${scheduleName ?? "group"}`}
            className={cn(
              "rounded-xl border border-border/60 bg-card/50 space-y-2",
              compact ? "p-2" : "p-3"
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
                {formatDayList(group.days)}
              </span>
              <Badge variant="secondary" className="text-[10px] font-normal">
                1 SSA
              </Badge>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-[6.5rem] shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Shift Type
                </span>
                <span className="truncate text-xs text-foreground">{shiftTypeName}</span>
                {typeCreating ? (
                  <Badge variant="outline" className="ml-auto shrink-0 text-[10px] font-normal">
                    New
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <span className="w-[6.5rem] shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Shift Schedule
                </span>
                <span className="truncate text-xs text-foreground">{scheduleName}</span>
                {scheduleCreating ? (
                  <Badge variant="outline" className="ml-auto shrink-0 text-[10px] font-normal">
                    New
                  </Badge>
                ) : null}
              </div>
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {formatTimeInput(group.profile.start_time)}–{formatTimeInput(group.profile.end_time)}
              {group.profile.lunch_start && group.profile.lunch_end
                ? ` · lunch ${formatTimeInput(group.profile.lunch_start)}–${formatTimeInput(group.profile.lunch_end)}`
                : " · no lunch"}
              {group.profile.grace_minutes ? ` · ${group.profile.grace_minutes}m grace` : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

import { employeeInitials } from "@/lib/employeeCard";
import { cn } from "@/lib/utils";
import type { CalendarEmployee } from "@/types/calendar";

export type EmployeeAvatarProps = {
  employee: CalendarEmployee | null;
  fallbackId?: string | null;
  className?: string;
  imageClassName?: string;
};

export function EmployeeAvatar(props: EmployeeAvatarProps) {
  return (
    <span className={cn("relative shrink-0", props.className)}>
      <span
        className={cn(
          "flex size-full items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground",
          props.imageClassName
        )}
      >
        {props.employee?.image ? (
          <img
            src={props.employee.image}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          employeeInitials(props.employee, props.fallbackId ?? null)
        )}
      </span>
    </span>
  );
}

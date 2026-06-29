import type { ReactNode } from "react";

import { formatEmploymentType } from "@/lib/employeeCard";
import type { CoverageEmployee } from "@/lib/scheduleCoverage";
import type { CalendarEmployee } from "@/types/calendar";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";

/** EmployeeAvatar wants a CalendarEmployee; coverage rows only carry a subset. */
function avatarEmployee(employee: CoverageEmployee): CalendarEmployee {
  return {
    id: employee.id,
    employee_name: employee.employee_name,
    image: employee.image ?? null,
  } as unknown as CalendarEmployee;
}

export function EmployeeLine({
  employee,
  trailing,
}: {
  employee: CoverageEmployee;
  trailing?: ReactNode;
}) {
  const meta = [
    employee.id,
    employee.department || null,
    employee.employment_type ? formatEmploymentType(employee.employment_type) : null,
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-3">
      <EmployeeAvatar employee={avatarEmployee(employee)} fallbackId={employee.id} className="size-9" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-snug">
          {employee.employee_name || employee.id}
        </div>
        <div className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</div>
      </div>
      {trailing}
    </div>
  );
}

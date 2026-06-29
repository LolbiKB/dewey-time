import { CalendarPlusIcon, CheckCircle2Icon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import type { CoverageEmployee } from "@/lib/scheduleCoverage";
import { EmployeeLine } from "@/ui/schedule-coverage/EmployeeLine";

export function UnassignedList({ employees }: { employees: CoverageEmployee[] }) {
  const navigate = useNavigate();

  if (employees.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
        <CheckCircle2Icon className="size-8 text-primary/70" />
        <p className="text-sm font-medium">Everyone has a schedule</p>
        <p className="text-xs text-muted-foreground">
          Every active employee has a shift assignment. Nice.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {employees.map((emp) => (
        <li
          key={emp.id}
          className="rounded-lg border border-border/60 bg-card/40 px-3 py-2.5"
        >
          <EmployeeLine
            employee={emp}
            trailing={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1.5 text-xs"
                onClick={() =>
                  navigate(`/hr-schedule?employee=${encodeURIComponent(emp.id)}`)
                }
              >
                <CalendarPlusIcon className="size-3.5" />
                Add schedule
              </Button>
            }
          />
        </li>
      ))}
    </ul>
  );
}

import type { ColumnDef } from "@tanstack/react-table";

import { Badge, Button } from "@lolbikb/dewey-ui";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import type { RegisterRow } from "@/lib/coverageRegister";

const BIOMETRIC_LABEL: Record<NonNullable<RegisterRow["biometric"]>, string> = {
  enrolled: "Enrolled",
  enrolled_not_punching: "Enrolled, not punching",
  none: "No fingerprint",
  still_enrolled: "Still enrolled",
};

/**
 * Only a positive statement of absence is destructive. "Enrolled, not punching"
 * is neutral: they CAN clock in and simply have not, which is an attendance
 * question, not a coverage one — the same rule isNotReady applies.
 */
const BIOMETRIC_VARIANT: Record<NonNullable<RegisterRow["biometric"]>, "secondary" | "outline" | "destructive"> = {
  enrolled: "secondary",
  enrolled_not_punching: "outline",
  none: "destructive",
  still_enrolled: "destructive",
};

/** Ids MUST match visibleColumnIds() — a mismatch hides a column permanently. */
export function registerColumns(
  onOpen: (row: RegisterRow) => void,
  onAddSchedule: (row: RegisterRow) => void,
): ColumnDef<RegisterRow, unknown>[] {
  return [
    {
      id: "employee",
      header: "Employee",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.original.employee_name}</span>
          <span className="truncate text-xs text-muted-foreground">{row.original.id}</span>
        </span>
      ),
    },
    { id: "branch", header: "Branch", cell: ({ row }) => row.original.branch ?? "—" },
    { id: "department", header: "Dept", cell: ({ row }) => row.original.department ?? "—" },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.status ? (
          <Badge variant={row.original.status === "Left" ? "destructive" : "secondary"}>
            {row.original.status}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      id: "schedule",
      header: "Schedule",
      cell: ({ row }) => {
        if (row.original.schedule === null) return "—";
        return (
          <Badge variant={row.original.schedule === "missing" ? "outline" : "secondary"}>
            {row.original.schedule === "missing" ? "Missing" : "Assigned"}
          </Badge>
        );
      },
    },
    {
      id: "weekly_minutes",
      header: "Hrs/wk",
      cell: ({ row }) =>
        row.original.weekly_minutes === null
          ? "—"
          : formatScheduleDuration(row.original.weekly_minutes),
    },
    {
      id: "biometric",
      header: "Biometric",
      cell: ({ row }) => {
        const value = row.original.biometric;
        if (value === null) return "—";
        const days = row.original.days_since_relieving;
        return (
          <span className="flex items-center gap-1.5">
            <Badge variant={BIOMETRIC_VARIANT[value]}>{BIOMETRIC_LABEL[value]}</Badge>
            {value === "still_enrolled" && days !== null ? (
              <span className="text-xs tabular-nums text-destructive">
                {days} {days === 1 ? "day" : "days"}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "fingerprint_count",
      header: "Prints",
      cell: ({ row }) =>
        row.original.fingerprint_count === null ? "—" : row.original.fingerprint_count,
    },
    {
      id: "action",
      header: "",
      // Empty unless the row has a problem. A button on every row is noise, and
      // it is what made the old Needs list read as a to-do list.
      cell: ({ row }) => {
        if (row.original.schedule === "missing") {
          return (
            <Button size="sm" variant="outline" onClick={() => onAddSchedule(row.original)}>
              Add schedule
            </Button>
          );
        }
        if (row.original.biometric === "none" || row.original.biometric === "still_enrolled") {
          return (
            <Button size="sm" variant="ghost" onClick={() => onOpen(row.original)}>
              Open
            </Button>
          );
        }
        return null;
      },
    },
  ];
}

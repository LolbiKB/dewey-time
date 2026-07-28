import { frappeCall } from "@/lib/frappe";
import type { ScheduleCoveragePayload } from "@/lib/scheduleCoverage";

export function getScheduleCoverage() {
  return frappeCall<ScheduleCoveragePayload>(
    "dewey_time.attendance_engine.coverage_api.get_schedule_coverage",
  );
}

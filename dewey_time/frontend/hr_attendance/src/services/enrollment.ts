import { frappeCall } from "@/lib/frappe";
import type { EnrollmentPayload } from "@/lib/enrollmentReport";

export function getEnrollmentReport() {
  return frappeCall<EnrollmentPayload>(
    "dewey_time.attendance_engine.enrollment_api.get_enrollment_report",
  );
}

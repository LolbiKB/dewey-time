import { useEnrollmentReport } from "@/hooks/useEnrollmentReport";
import { BiometricEnrollmentView } from "@/ui/BiometricEnrollmentView";
import { CoverageViewNav } from "@/ui/schedule-coverage/CoverageViewNav";

export function BiometricEnrollmentPage() {
  const { payload, isLoading, error } = useEnrollmentReport();

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4">
        <CoverageViewNav />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="p-6 text-sm text-destructive">
          Could not load the enrollment report.
        </div>
      ) : (
        <BiometricEnrollmentView payload={payload} nowMs={Date.now()} />
      )}
    </div>
  );
}

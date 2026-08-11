import { EmptyState } from "@lolbikb/dewey-ui";
import { Navigate, useOutletContext } from "react-router-dom";

import { FailureBlock } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { useEnrollmentReport } from "@/hooks/useEnrollmentReport";
import { BiometricEnrollmentView } from "@/ui/BiometricEnrollmentView";
import { CoverageViewNav } from "@/ui/schedule-coverage/CoverageViewNav";

export function BiometricEnrollmentPage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const { payload, isLoading, error, refresh } = useEnrollmentReport();

  // The same gate the four sibling routed pages implement. The shell hides the
  // Coverage tab from non-HR, but the URL is reachable by bookmark, and without
  // this the backend's "Not permitted" arrived as "Could not load the
  // enrollment report" with a Retry that can never succeed — an authorisation
  // denial presented as a system failure.
  if (sessionLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={Spinner} title="Loading…" className="border-none" />
      </div>
    );
  }
  if (!hrStaff) {
    return <Navigate to="/hr-attendance" replace />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4">
        <CoverageViewNav />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="flex flex-1 flex-col p-4">
          <FailureBlock
            title="Could not load the enrollment report"
            onRetry={refresh}
          />
        </div>
      ) : (
        <BiometricEnrollmentView payload={payload} nowMs={Date.now()} />
      )}
    </div>
  );
}

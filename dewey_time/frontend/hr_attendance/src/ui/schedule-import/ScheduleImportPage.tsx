import { EmptyState, Page, PageHeader, Section } from "@lolbikb/dewey-ui";
import { ArrowLeftIcon } from "lucide-react";
import { Link, Navigate, useNavigate, useOutletContext } from "react-router-dom";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useScheduleImport, type ImportStep } from "@/hooks/useScheduleImport";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { ReviewStep } from "@/ui/schedule-import/ReviewStep";
import { UploadStep } from "@/ui/schedule-import/UploadStep";

const STEPS: { key: "upload" | "review" | "apply"; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "review", label: "Review" },
  { key: "apply", label: "Apply" },
];

function stepStage(step: ImportStep): "upload" | "review" | "apply" {
  if (step === "idle" || step === "parsing") return "upload";
  if (step === "preview") return "review";
  return "apply";
}

function StepIndicator({ step }: { step: ImportStep }) {
  const stage = stepStage(step);
  const order = STEPS.map((s) => s.key);
  const activeIndex = order.indexOf(stage);
  return (
    <ol className="flex items-center gap-1.5 text-xs">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium transition-colors",
              i === activeIndex
                ? "bg-primary/10 text-primary"
                : i < activeIndex
                  ? "text-foreground"
                  : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums",
                i === activeIndex
                  ? "bg-primary text-primary-foreground"
                  : i < activeIndex
                    ? "bg-foreground/80 text-background"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {i + 1}
            </span>
            {s.label}
          </span>
          {i < STEPS.length - 1 ? <span className="text-muted-foreground/50">›</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function ScheduleImportPage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const navigate = useNavigate();
  const controller = useScheduleImport();

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

  const stage = stepStage(controller.step);

  return (
    <Page>
      <Link
        to="/hr-schedule"
        className="inline-flex w-fit shrink-0 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Weekly Schedule
      </Link>

      <PageHeader
        title="Import from spreadsheet"
        description="Validate a normalised CSV, then apply schedules in bulk."
      >
        {/* StepIndicator is ~250-260px and never wraps/shrinks — PageHeader's
            title/actions row doesn't wrap at any width (min-w-0 + truncate on
            the title, shrink-0 on actions), so it belongs in `children` as
            its own full-width row below the title, not in `actions`, or it
            collapses the title to a sliver at phone width. Same rule Task 3
            documented for WeeklySchedulePage's dialog-trigger row. */}
        <StepIndicator step={controller.step} />
      </PageHeader>

      <Section grow className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {stage === "upload" ? (
          <UploadStep
            onFile={(file) => void controller.handleFile(file)}
            parsing={controller.step === "parsing"}
            parseError={controller.parseError}
            fileName={controller.currentFileName}
          />
        ) : (
          <ReviewStep
            controller={controller}
            onBackToSchedule={() => navigate("/hr-schedule")}
          />
        )}
      </Section>
    </Page>
  );
}

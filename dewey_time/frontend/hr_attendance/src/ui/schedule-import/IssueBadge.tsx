import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ImportIssue } from "@/types/scheduleImport";
import { ISSUE_CODE_LABELS } from "@/ui/schedule-import/constants";

export function IssueBadge({
  issue,
  derivedType,
}: {
  issue: ImportIssue;
  /** When the type was derived, show the actual value (e.g. "→ Full-time"). */
  derivedType?: string | null;
}) {
  const label =
    issue.code === "EMPLOYMENT_TYPE_DERIVED" && derivedType
      ? `→ ${derivedType}`
      : (ISSUE_CODE_LABELS[issue.code] ?? issue.code);
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-normal",
        issue.severity === "error" && "border-destructive/40 text-destructive",
        issue.severity === "warning" && "border-brand-accent/40 text-brand-accent",
        issue.severity === "info" && "border-border text-muted-foreground"
      )}
      title={issue.suggestion ?? issue.message}
    >
      {label}
    </Badge>
  );
}

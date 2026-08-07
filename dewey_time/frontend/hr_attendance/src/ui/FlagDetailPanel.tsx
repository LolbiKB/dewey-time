import { ExternalLinkIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  flagDeskUrl,
  flagDialogTitle,
  flagFinalizationLabel,
  flagHrGuidance,
  flagIsProvisional,
  flagSummary,
  formatFlagContextDate,
  formatFlagEvidenceDetails,
  formatFlagStatusLabel,
  formatSeverityLabel,
} from "@/lib/flagDetails";
import { flagNarrative, type NarrativeDay } from "@/lib/flagNarrative";
import { cn } from "@/lib/utils";
import type { Flag } from "@/types/calendar";
import { FlagEvidenceTimeline } from "@/ui/FlagEvidenceTimeline";

export type FlagDetailPanelProps = {
  flag: Flag;
  date: string;
  employeeLabel: string | null;
  employeeId: string | null;
  /**
   * The day's checkins/shift/holiday/lunch context, for flagNarrative()'s
   * timeline (design rule 11: fed from the day's real checkin list, never
   * the evidence blob). DayInspectorSheet.tsx builds this from the same
   * `Day` it already has in scope, via narrativeDayFrom(). Required, not
   * optional — a caller that forgets it gets a compile error, not a
   * silently timeline-less card.
   */
  day: NarrativeDay;
  showDeskReview?: boolean;
};

export function FlagDetailPanel(props: FlagDetailPanelProps) {
  const { flag, date } = props;
  const evidence = formatFlagEvidenceDetails(flag.evidence, date);
  const narrative = flagNarrative(flag, props.day, date);
  const finalization = flagFinalizationLabel(flag);
  const provisional = flagIsProvisional(flag);
  const guidance = flagHrGuidance(flag);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <div className="text-base font-semibold tracking-tight">{flagDialogTitle(flag)}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {props.employeeLabel ?? "Employee"}
            {props.employeeId && props.employeeLabel !== props.employeeId ? (
              <span className="text-muted-foreground/80"> · {props.employeeId}</span>
            ) : null}
          </div>
          <div className="text-sm text-muted-foreground">{formatFlagContextDate(date)}</div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="rounded-md text-[11px]">
            {formatFlagStatusLabel(flag.status)}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "rounded-md text-[11px]",
              flag.severity === "CRITICAL" &&
                "border-destructive/40 bg-destructive/10 text-destructive",
              flag.severity === "WARNING" &&
                "border-brand-accent/40 bg-brand-accent/10 text-brand-accent",
              flag.severity === "INFO" && "border-border bg-muted/40 text-foreground"
            )}
          >
            {formatSeverityLabel(flag.severity)}
          </Badge>
          {finalization ? (
            <Badge
              variant="outline"
              className="rounded-md text-[11px] border-dashed border-border bg-muted/30 text-muted-foreground"
            >
              {finalization}
            </Badge>
          ) : null}
        </div>
      </div>

      <section className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3">
        <div className="text-xs font-medium text-muted-foreground">Summary</div>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{flagSummary(flag.flag_code)}</p>
      </section>

      {/* The verdict, not the fields (Headline voice rule 1): flagNarrative()
          replaces the unfiltered dump of every evidence key as the first
          thing HR reads. The same dump still renders below, collapsed —
          Global Constraint 3, nothing becomes unreachable, it just stops
          being first. See
          docs/superpowers/specs/2026-08-06-flag-evidence-panel-design.md. */}
      <section className="space-y-3">
        <div>
          <div className="text-base font-semibold tracking-tight text-foreground">
            {narrative.headline}
          </div>
          {narrative.subline ? (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {narrative.subline}
            </p>
          ) : null}
        </div>

        {narrative.timeline ? (
          <FlagEvidenceTimeline
            spec={narrative.timeline}
            ariaLabel={`${narrative.headline} timeline`}
          />
        ) : null}

        {narrative.facts.length > 0 ? (
          <dl className="space-y-2 rounded-xl border border-border/60 bg-card px-3 py-2.5">
            {narrative.facts.map((fact) => (
              <div key={fact.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 text-xs">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="font-medium text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {evidence.rows.length > 0 || evidence.fallbackJson ? (
          <details className="rounded-xl border border-border/60 bg-muted/10 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Full evidence
            </summary>
            <div className="mt-2 space-y-3">
              {evidence.rows.length > 0 ? (
                <dl className="space-y-2 rounded-lg border border-border/60 bg-card px-3 py-2.5">
                  {evidence.rows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 text-xs">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-medium text-foreground">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {evidence.fallbackJson ? (
                <pre className="max-h-40 overflow-auto text-[11px] leading-relaxed text-muted-foreground">
                  {evidence.fallbackJson}
                </pre>
              ) : null}
            </div>
          </details>
        ) : null}
      </section>

      <section className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-3">
        <div className="text-xs font-medium text-primary/80">Recommended for HR</div>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{guidance}</p>
      </section>

      <Separator />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {props.showDeskReview !== false ? (
          <Button variant="link" size="sm" className="gap-1.5 px-0" asChild>
            <a href={flagDeskUrl(flag.name)} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              Open record
            </a>
          </Button>
        ) : null}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Record ID: <span className="font-mono">{flag.name}</span>
        {" · "}
        Code: <span className="font-mono">{flag.flag_code}</span>
      </p>
    </div>
  );
}

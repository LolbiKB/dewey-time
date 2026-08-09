import { EmptyState } from "@lolbikb/dewey-ui";
import { FlagIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  decisionIsComplete,
  flagIdentities,
  groupPayload,
  remainingIdentities,
  type PendingDecision,
} from "@/lib/flagDecisionState";
import { flagSummary, formatFlagContextDate, formatFlagEvidenceDetails } from "@/lib/flagDetails";
import { flagNarrative, type NarrativeDay } from "@/lib/flagNarrative";
import { formatFlagLabel, parseFlagEvidence } from "@/lib/flagLabels";
import {
  DECIDE_AGAIN_LABEL,
  DECIDE_ONE_BY_ONE_LABEL,
  DECIDE_ONE_LABEL,
  OUTCOME_OPTIONS,
  REASON_OPTIONS,
  SAME_REASON_LABEL,
  appliedDecisionLabel,
  applyToRemainingLabel,
  crossReferenceLabel,
  decisionStateLabel,
  flagDayLabel,
  groupHeadline,
  groupSubline,
  outcomeActionLabel,
  outcomeLabel,
  personHeadline,
  priorDecisionLabel,
  reasonLabel,
  restHeading,
} from "@/lib/flagQueueLabels";
import { cn } from "@/lib/utils";
import type { Flag } from "@/types/calendar";
import type { FlagOut, QueueEntry, QueuePerson, Reason } from "@/types/flags";
import { FlagEvidenceTimeline } from "@/ui/FlagEvidenceTimeline";

type GroupEntry = Extract<QueueEntry, { kind: "group" }>;

/**
 * flag_queue_api.get_flag_queue (attendance_engine/flag_queue_api.py) never
 * returns checkins, shift, holiday or observed_lunch — it is a flat queue
 * payload, not a calendar day — and FlagQueuePage's only caller-supplied
 * context, HrAccessOutletContext (lib/hrAccess.ts), carries just
 * hrStaff/sessionLoading. Unlike FlagDetailPanel's DayInspectorSheet, there
 * is no caller anywhere in this surface's chain to thread real day data
 * from. flagNarrative() still needs *a* NarrativeDay — this is the honest
 * empty one, so timelines on this card degrade to whatever flagNarrative()
 * decides for zero checkins rather than crashing.
 */
const EMPTY_NARRATIVE_DAY: NarrativeDay = { checkins: [] };

/**
 * flagNarrative()'s signature takes Flag (types/calendar.ts, the shape
 * hr_calendar.py's get_my_week returns), not FlagOut (types/flags.ts, what
 * this queue payload returns): flag_identity where Flag has name, and no
 * `source` field at all. Design rule 11's no-detector fallback reads
 * flag.source to survive empty evidence; on this surface it is always
 * undefined — a documented, harmless gap, since the fallback still shows its
 * label and reason, just without a source line.
 */
function flagOutToFlag(flag: FlagOut): Flag {
  return {
    name: flag.flag_identity,
    flag_code: flag.flag_code,
    severity: flag.severity as Flag["severity"],
    day_closed: flag.day_closed as 0 | 1,
    evidence: flag.evidence,
  };
}

export type FlagDecisionPanelProps = {
  entry: QueueEntry | null;
  /** The form's working copy. Owned by the page so selecting a new row resets it. */
  draft: PendingDecision;
  onDraftChange: (draft: PendingDecision) => void;
  /** Person mode: which flag currently has its decide form open. */
  activeIdentity: string | null;
  onOpenFlag: (identity: string | null) => void;
  /** Which of the compressed flags has been promoted to a full card. */
  expandedIdentity: string | null;
  onExpandFlag: (identity: string | null) => void;
  /** The decision HR last recorded on THIS person — backs "Same reason applies". */
  lastDecision: PendingDecision | null;
  onSubmit: (identities: string[], decision: PendingDecision) => void;
  /** Group mode: employees whose checkbox has been unchecked. */
  excluded: ReadonlySet<string>;
  onToggleMember: (employee: string) => void;
  onDecideOneByOne: () => void;
  submitting?: boolean;
};

export function FlagDecisionPanel(props: FlagDecisionPanelProps) {
  if (!props.entry) {
    return (
      <EmptyState
        icon={FlagIcon}
        title="Pick a row to review"
        description="Groups and people are ranked by consequence — work down from the top."
        className="border-none"
      />
    );
  }

  return props.entry.kind === "group" ? (
    <GroupDecision {...props} entry={props.entry} />
  ) : (
    <PersonDecision {...props} person={props.entry} />
  );
}

function PersonDecision(props: FlagDecisionPanelProps & { person: QueuePerson }) {
  const { person } = props;
  const remaining = remainingIdentities(person);
  // The one card that stays open is the worst flag STILL AWAITING a decision.
  // build_queue hands the array over worst-first, so the first unresolved flag is
  // the worst unresolved one — the same rule _person() uses to choose the row's
  // headline date. When every flag is already decided (the "Decided" toggle is
  // on) nothing is awaiting, and the worst flag overall takes the card.
  const worstIndex = person.flags.findIndex((flag) => flag.decision_state !== "matched");
  const worst = person.flags[worstIndex === -1 ? 0 : worstIndex];
  // Identity comparison, not index arithmetic: each FlagOut is a distinct object,
  // and this keeps build_queue's order for everything that is not the card.
  const rest = person.flags.filter((flag) => flag !== worst);

  return (
    <div className="space-y-4 pb-4">
      <header>
        <div className="text-base font-semibold tracking-tight">{person.employee_name}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {/* An entry can span dates now — a pattern member holds several
              mornings. Naming only the headline day would label the others
              wrongly, so a multi-day entry states its range end to end. */}
          {person.dates.length > 1
            ? `${formatFlagContextDate(person.dates[0])} – ${formatFlagContextDate(person.dates[person.dates.length - 1])}`
            : formatFlagContextDate(person.attendance_date)}
          {person.employee_branch ? (
            <span className="text-muted-foreground/80"> · {person.employee_branch}</span>
          ) : null}
        </div>
      </header>

      {/* One click, one write — this prefills nothing and submits nothing on its
          own. It only exists once HR has actually decided something on this
          person, which is what stops a stray click closing a whole day. */}
      {props.lastDecision && remaining.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {SAME_REASON_LABEL} — {outcomeLabel(props.lastDecision.outcome)},{" "}
            {reasonLabel(props.lastDecision.reason)}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={props.submitting}
            onClick={() => props.onSubmit(remaining, props.lastDecision as PendingDecision)}
          >
            {applyToRemainingLabel(remaining.length)}
          </Button>
        </div>
      ) : null}

      {/* The worst flag in full, the rest as one-liners.
          The path through a multi-flag person is: read the worst one, decide it,
          then "same reason applies" to the remainder — which is what
          remainingIdentities and applyToRemainingLabel are already for. Fourteen
          full cards rendered the same per-code explainer fourteen times and
          restated each flag's own numbers twice (prose, then a facts table), for
          5,069px in a 345px pane. Nothing is removed here except repetition:
          every flag is still individually decidable through its one-liner.

          Guarded on `worst` rather than on a length check so the type narrows for
          FlagCard, and a fragment rather than a wrapper div so the parent's
          `space-y-4` keeps applying between the card and the list. */}
      {worst ? (
        <>
          <FlagCard
            key={worst.flag_identity}
            flag={worst}
            dateKey={worst.attendance_date}
            open={props.activeIdentity === worst.flag_identity}
            draft={props.draft}
            onDraftChange={props.onDraftChange}
            onOpen={() => props.onOpenFlag(worst.flag_identity)}
            onClose={() => props.onOpenFlag(null)}
            lastDecision={props.lastDecision}
            onSubmit={props.onSubmit}
            submitting={props.submitting}
          />

          {rest.length > 0 ? (
            <section data-slot="flag-rest" className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                {restHeading(rest)}
              </div>
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                {rest.map((flag) =>
                  props.expandedIdentity === flag.flag_identity ? (
                    <li key={flag.flag_identity} className="p-1.5">
                      <FlagCard
                        flag={flag}
                        dateKey={flag.attendance_date}
                        open={props.activeIdentity === flag.flag_identity}
                        draft={props.draft}
                        onDraftChange={props.onDraftChange}
                        onOpen={() => props.onOpenFlag(flag.flag_identity)}
                        onClose={() => props.onOpenFlag(null)}
                        lastDecision={props.lastDecision}
                        onSubmit={props.onSubmit}
                        submitting={props.submitting}
                      />
                    </li>
                  ) : (
                    <li key={flag.flag_identity}>
                      <FlagOneLiner
                        flag={flag}
                        onExpand={() => props.onExpandFlag(flag.flag_identity)}
                      />
                    </li>
                  ),
                )}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** One flag, compressed to what distinguishes it from its siblings: the day and
 *  the magnitude. Everything else on a full card is either identical across the
 *  set (the per-code explainer) or a second telling of these same two numbers. */
function FlagOneLiner(props: { flag: FlagOut; onExpand: () => void }) {
  return (
    <button
      type="button"
      data-slot="flag-one-liner"
      onClick={props.onExpand}
      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/40"
    >
      <span className="w-14 shrink-0 text-muted-foreground tabular-nums">
        {flagDayLabel(props.flag.attendance_date)}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {formatFlagLabel(props.flag.flag_code, parseFlagEvidence(props.flag.evidence))}
      </span>
      {props.flag.decision_state !== "undecided" ? (
        <Badge variant="outline" className="shrink-0 rounded-md text-[10px]">
          {decisionStateLabel(props.flag.decision_state)}
        </Badge>
      ) : null}
      <span className="shrink-0 text-[11px] font-medium text-primary">{DECIDE_ONE_LABEL}</span>
    </button>
  );
}

function FlagCard(props: {
  flag: FlagOut;
  dateKey: string;
  open: boolean;
  draft: PendingDecision;
  onDraftChange: (draft: PendingDecision) => void;
  onOpen: () => void;
  onClose: () => void;
  lastDecision: PendingDecision | null;
  onSubmit: (identities: string[], decision: PendingDecision) => void;
  submitting?: boolean;
}) {
  const { flag } = props;
  const evidence = formatFlagEvidenceDetails(flag.evidence, props.dateKey);
  const narrative = flagNarrative(flagOutToFlag(flag), EMPTY_NARRATIVE_DAY, props.dateKey);
  const decided = flag.decision_state === "matched";

  return (
    <section
      data-slot="flag-card"
      className="space-y-2.5 rounded-xl border border-border/60 bg-card px-3 py-3"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="text-sm font-medium text-foreground">
              {formatFlagLabel(flag.flag_code, parseFlagEvidence(flag.evidence))}
            </span>
            {/* Which day this card decides. Three "Late by 12 min" cards in one
                entry are three different mornings, and the header above only
                gives the range. */}
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {flagDayLabel(props.dateKey)}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {flagSummary(flag.flag_code)}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-md text-[11px]",
            flag.decision_state === "needs_re_review" &&
              "border-brand-accent/40 bg-brand-accent/10 text-brand-accent",
          )}
        >
          {decisionStateLabel(flag.decision_state)}
        </Badge>
      </div>

      {/* The verdict, not the fields — same flagNarrative() idiom as
          FlagDetailPanel.tsx, so a change there lands here too (was: same
          dl/dt/dd idiom for the raw evidence.rows, unfiltered). This card
          always computes against EMPTY_NARRATIVE_DAY (see above) — this
          surface has no live calendar day. */}
      <div className="space-y-1">
        <p className="text-xs font-medium leading-relaxed text-foreground">{narrative.headline}</p>
        {narrative.subline ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{narrative.subline}</p>
        ) : null}
      </div>

      {narrative.timeline ? (
        <FlagEvidenceTimeline
          spec={narrative.timeline}
          ariaLabel={`${narrative.headline} timeline`}
        />
      ) : null}

      {narrative.facts.length > 0 ? (
        <dl className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
          {narrative.facts.map((fact) => (
            <div key={fact.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 text-xs">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="font-medium text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Deliberately the same disclosure structure as FlagDetailPanel.tsx's,
          but a SECOND, INDEPENDENT copy of it — the two panels no longer
          share a layout, so a change here (or to what
          formatFlagEvidenceDetails returns) must be mirrored there by hand
          or the two surfaces will drift apart. Both `.rows` AND
          `.fallbackJson` now live behind this <details>; before this task
          `.fallbackJson` was read nowhere on this card (only `.rows` was,
          rendered uncollapsed), so a flag with leftover keys had no way to
          reach HR here at all. */}
      {evidence.rows.length > 0 || evidence.fallbackJson ? (
        <details className="rounded-lg border border-border/60 bg-muted/10 px-2.5 py-1.5">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
            Full evidence
          </summary>
          <div className="mt-2 space-y-2">
            {evidence.rows.length > 0 ? (
              <dl className="space-y-1.5 rounded-lg border border-border/60 bg-card px-2.5 py-2">
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

      {/* CONTEXT, not an outcome. The evidence fingerprint moved under this
          decision, so the backend deliberately did not apply it and put the flag
          back in the queue. Styling it like a live decision would tell HR the day
          is handled when it is not. */}
      {flag.decision && flag.decision_state === "needs_re_review" ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {priorDecisionLabel(flag.decision)}
        </p>
      ) : null}

      {/* The decision in force, kept on screen while the form below is open —
          this is what HR is replacing, and they should be able to read it while
          they type the reason they are replacing it. */}
      {flag.decision && decided ? (
        <p className="text-xs text-muted-foreground">{appliedDecisionLabel(flag.decision)}</p>
      ) : null}

      {/* A decided flag is decidable AGAIN, through this same form. That is the
          only way HR can correct a decision they got wrong: the write is an
          ordinary decide_flags call on the same flag_identity, which the backend
          records as a new row superseding the old one — nothing is edited and
          nothing is deleted. */}
      {props.open ? (
        <DecisionForm
          draft={props.draft}
          onChange={props.onDraftChange}
          submitLabel={outcomeActionLabel(props.draft.outcome)}
          onSubmit={() => props.onSubmit(flagIdentities(flag), props.draft)}
          onCancel={props.onClose}
          submitting={props.submitting}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={decided ? "outline" : "default"} onClick={props.onOpen}>
            {decided ? DECIDE_AGAIN_LABEL : "Decide"}
          </Button>
          {/* Only for flags still awaiting one: repeating the day's decision onto
              a flag that already has one would be a supersession nobody asked
              for, recorded under HR's name. */}
          {!decided && props.lastDecision ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={props.submitting}
              onClick={() =>
                props.onSubmit(flagIdentities(flag), props.lastDecision as PendingDecision)
              }
            >
              {SAME_REASON_LABEL}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function GroupDecision(props: FlagDecisionPanelProps & { entry: GroupEntry }) {
  const { entry } = props;
  // groupPayload owns both halves of the exclusion rule — drop every flag of an
  // excluded employee, and only ever send undecided identities. The action label
  // reads `coveredEmployeeCount`, not `employeeCount`: a checked member whose
  // only unresolved flag is needs_re_review contributes no identity, so counting
  // them would promise a write that will not happen for them.
  const payload = groupPayload(entry.members, props.excluded);

  return (
    <div className="space-y-4 pb-4">
      <header>
        <div className="text-base font-semibold tracking-tight">{groupHeadline(entry)}</div>
        {/* REPEAT_PATTERN spans dates by definition and carries no single one,
            so the day is conditional — handing that null to a date formatter
            throws, which would take the whole panel down the first time HR
            opened a pattern group. The size line is never conditional, and it
            is groupSubline's job so the panel and the list row agree. */}
        <div className="mt-1 text-sm text-muted-foreground">
          {entry.attendance_date ? (
            <>
              {formatFlagContextDate(entry.attendance_date)}
              <span className="text-muted-foreground/80 tabular-nums">
                {" "}
                · {groupSubline(entry)}
              </span>
            </>
          ) : (
            <span className="tabular-nums">{groupSubline(entry)}</span>
          )}
        </div>
      </header>

      <DecisionForm
        draft={props.draft}
        onChange={props.onDraftChange}
        submitLabel={`${outcomeActionLabel(props.draft.outcome)} ${payload.coveredEmployeeCount}`}
        onSubmit={() => props.onSubmit(payload.identities, props.draft)}
        submitting={props.submitting || payload.coveredEmployeeCount === 0}
      />

      <Button variant="outline" size="sm" onClick={props.onDecideOneByOne}>
        {DECIDE_ONE_BY_ONE_LABEL}
      </Button>

      <section className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">Who this covers</div>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-border/60 px-2 py-1.5">
          {entry.members.map((member) => {
            const crossReference = crossReferenceLabel(member);
            return (
              <li key={member.employee} className="flex items-center gap-2 py-1">
                <Checkbox
                  checked={!props.excluded.has(member.employee)}
                  onCheckedChange={() => props.onToggleMember(member.employee)}
                  aria-label={`Include ${member.employee_name}`}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {member.employee_name}
                </span>
                {/* The safeguard's primary surface. This list, with its exclude
                    checkboxes, is what HR reads immediately before a bulk
                    excuse — the exact moment the badge is for. Reaching it only
                    through "Decide one by one" would mean it never appears on
                    the path it exists to guard. */}
                {crossReference ? (
                  <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                    {crossReference}
                  </span>
                ) : null}
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {personHeadline(member)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function DecisionForm(props: {
  draft: PendingDecision;
  onChange: (draft: PendingDecision) => void;
  submitLabel: string;
  onSubmit: () => void;
  onCancel?: () => void;
  submitting?: boolean;
}) {
  // The note rule (required when reason is OTHER or the outcome is UPHELD) lives
  // in decisionIsComplete and is duplicated nowhere here — the form only reads
  // its verdict, so it can never drift from what the doctype's validate() will
  // accept.
  const complete = decisionIsComplete(props.draft);

  return (
    <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2.5">
      <div role="group" aria-label="Outcome" className="flex gap-1 rounded-md bg-muted/40 p-1">
        {OUTCOME_OPTIONS.map((option) => {
          const active = props.draft.outcome === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => props.onChange({ ...props.draft, outcome: option })}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {outcomeActionLabel(option)}
            </button>
          );
        })}
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Reason</span>
        {/* A native <select>, not dewey-ui's Radix Select: Radix renders its items
            into a portal, which renderToStaticMarkup never emits and which is
            unreachable before hydration. Seven fixed options do not need a
            combobox, and this way the list is actually in the markup. */}
        <select
          value={props.draft.reason}
          onChange={(event) =>
            props.onChange({ ...props.draft, reason: event.target.value as Reason })
          }
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
        >
          {REASON_OPTIONS.map((reason) => (
            <option key={reason} value={reason}>
              {reasonLabel(reason)}
            </option>
          ))}
        </select>
      </label>

      <Textarea
        value={props.draft.note}
        rows={2}
        placeholder="Note"
        onChange={(event) => props.onChange({ ...props.draft, note: event.target.value })}
        className="text-xs"
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!complete || props.submitting} onClick={props.onSubmit}>
          {props.submitLabel}
        </Button>
        {props.onCancel ? (
          <Button size="sm" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

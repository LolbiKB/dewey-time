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
import { formatFlagLabel, parseFlagEvidence } from "@/lib/flagLabels";
import {
  DECIDE_AGAIN_LABEL,
  DECIDE_ONE_BY_ONE_LABEL,
  OUTCOME_OPTIONS,
  REASON_OPTIONS,
  SAME_REASON_LABEL,
  appliedDecisionLabel,
  applyToRemainingLabel,
  decisionStateLabel,
  groupHeadline,
  outcomeActionLabel,
  outcomeLabel,
  personHeadline,
  priorDecisionLabel,
  reasonLabel,
} from "@/lib/flagQueueLabels";
import { cn } from "@/lib/utils";
import type { FlagOut, QueueEntry, QueuePerson, Reason } from "@/types/flags";

type GroupEntry = Extract<QueueEntry, { kind: "group" }>;

export type FlagDecisionPanelProps = {
  entry: QueueEntry | null;
  /** The form's working copy. Owned by the page so selecting a new row resets it. */
  draft: PendingDecision;
  onDraftChange: (draft: PendingDecision) => void;
  /** Person mode: which flag currently has its decide form open. */
  activeIdentity: string | null;
  onOpenFlag: (identity: string | null) => void;
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

  return (
    <div className="space-y-4 pb-4">
      <header>
        <div className="text-base font-semibold tracking-tight">{person.employee_name}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {formatFlagContextDate(person.attendance_date)}
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

      {/* Worst-first, exactly as build_queue ordered them, and every one of them
          individually decidable: the person only leaves the queue when all of
          their flags are decided. */}
      {person.flags.map((flag) => (
        <FlagCard
          key={flag.flag_identity}
          flag={flag}
          dateKey={person.attendance_date}
          open={props.activeIdentity === flag.flag_identity}
          draft={props.draft}
          onDraftChange={props.onDraftChange}
          onOpen={() => props.onOpenFlag(flag.flag_identity)}
          onClose={() => props.onOpenFlag(null)}
          lastDecision={props.lastDecision}
          onSubmit={props.onSubmit}
          submitting={props.submitting}
        />
      ))}
    </div>
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
  const decided = flag.decision_state === "matched";

  return (
    <section className="space-y-2.5 rounded-xl border border-border/60 bg-card px-3 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {formatFlagLabel(flag.flag_code, parseFlagEvidence(flag.evidence))}
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

      {/* Same dl/dt/dd shape as FlagDetailPanel.tsx — one evidence idiom across
          both surfaces, so a change to formatFlagEvidenceDetails lands in both
          without a second layout to keep in step. */}
      {evidence.rows.length > 0 ? (
        <dl className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
          {evidence.rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 text-xs">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
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
        <div className="mt-1 text-sm text-muted-foreground">
          {formatFlagContextDate(entry.attendance_date)}
          <span className="text-muted-foreground/80 tabular-nums">
            {" "}
            · {entry.members.length} people
          </span>
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
          {entry.members.map((member) => (
            <li key={member.employee} className="flex items-center gap-2 py-1">
              <Checkbox
                checked={!props.excluded.has(member.employee)}
                onCheckedChange={() => props.onToggleMember(member.employee)}
                aria-label={`Include ${member.employee_name}`}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {member.employee_name}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {personHeadline(member)}
              </span>
            </li>
          ))}
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

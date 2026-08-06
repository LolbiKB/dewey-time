import { useCallback, useMemo, useState, type ReactNode } from "react";
import { EmptyState, Page, PageHeader, Section } from "@lolbikb/dewey-ui";
import { useMutation } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { CloudOffIcon, TriangleAlertIcon } from "lucide-react";
import { Navigate, useOutletContext } from "react-router-dom";

import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { AttentionStrip, FailureBlock } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { useFlagQueue } from "@/hooks/useFlagQueue";
import type { PendingDecision } from "@/lib/flagDecisionState";
import { extractFrappeError } from "@/lib/frappeError";
import {
  DECIDE_FAILED_MESSAGE,
  DEVICE_ALERT_EXPLAINER,
  REASON_OPTIONS,
  SHOWING_DECIDED_MESSAGE,
  deviceAlertHeadline,
  partialFailureMessage,
} from "@/lib/flagQueueLabels";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { cn } from "@/lib/utils";
import { decideFlags } from "@/services/flags";
import type { QueueEntry, QueuePayload } from "@/types/flags";
import { FlagDecisionPanel } from "@/ui/FlagDecisionPanel";
import { FlagQueueList, entryKey } from "@/ui/FlagQueueList";

/** get_flag_queue caps a request at QUEUE_MAX_RANGE_DAYS (31); two weeks is the
 *  window HR actually works and keeps the payload well under QUEUE_FLAG_LIMIT. */
const QUEUE_DAYS = 14;

export type BulkFailure = {
  saved: number;
  attempted: number;
  errors: { flag_identity: string; error: string }[];
};

export type DecideArgs = {
  identities: string[];
  decision: PendingDecision;
  groupKey?: string | null;
  confirm?: boolean;
};

/**
 * The two shapes decide_flags can return, merged into one optional-field record.
 * The success path sends no discriminant, so narrowing on `needs_confirm` is the
 * only honest test — a union with a fabricated tag would be a lie about the wire
 * format.
 */
export type DecideResponse = {
  ok?: boolean;
  written?: number;
  group_key?: string;
  errors?: { flag_identity: string; error: string }[];
  needs_confirm?: boolean;
  preview?: { count: number; employees: number };
};

type PendingConfirm = { args: DecideArgs; preview: { count: number; employees: number } };

/** What a decide_flags response means for the page's state. */
export type DecideEffect =
  /** Over the backend's confirm threshold — show the blast radius, write nothing. */
  | { kind: "confirm"; preview: { count: number; employees: number } }
  | {
      kind: "settled";
      /**
       * The decision to offer as "Same reason applies", or null when the call
       * wrote nothing at all. Offering a repeat of a decision that never landed
       * would invite HR to propagate a failure across the rest of the day.
       */
      lastDecision: PendingDecision | null;
      bulkFailure: BulkFailure | null;
    };

/**
 * Pure reading of a *successful* HTTP response. Kept out of the mutation
 * callback so it can be tested directly: this suite renders components with
 * renderToStaticMarkup and has no harness for driving react-query, so logic
 * left inside `onSuccess` is logic nothing can reach.
 */
export function decideEffect(result: DecideResponse, args: DecideArgs): DecideEffect {
  if (result.needs_confirm) {
    return {
      kind: "confirm",
      preview: result.preview ?? { count: args.identities.length, employees: 0 },
    };
  }

  const written = result.written ?? 0;
  const errors = result.errors ?? [];

  return {
    kind: "settled",
    lastDecision: written > 0 ? args.decision : null,
    bulkFailure:
      errors.length > 0 ? { saved: written, attempted: args.identities.length, errors } : null,
  };
}

/** A fresh draft for a newly selected row. REASON_OPTIONS[0] only seeds the
 *  <select>'s value; nothing is written until HR clicks, and decisionIsComplete
 *  still gates the button. */
function emptyDraft(): PendingDecision {
  return { outcome: "EXCUSED", reason: REASON_OPTIONS[0], note: "" };
}

export function FlagQueuePage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();

  const range = useMemo(() => {
    const today = new Date();
    return {
      startDate: format(subDays(today, QUEUE_DAYS - 1), "yyyy-MM-dd"),
      endDate: format(today, "yyyy-MM-dd"),
    };
  }, []);

  // Off by default: the queue's job is what is still waiting on HR. Turned on,
  // people who have nothing outstanding come back into the list, which is the
  // only route to a decision HR wants to replace.
  const [includeDecided, setIncludeDecided] = useState(false);

  const { entries, counts, alerts, truncated, isLoading, error, refresh } = useFlagQueue({
    ...range,
    includeDecided,
  });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<PendingDecision>(emptyDraft);
  const [activeIdentity, setActiveIdentity] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<PendingDecision | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [bulkFailure, setBulkFailure] = useState<BulkFailure | null>(null);
  const [writeFailure, setWriteFailure] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // The selected row can be a group member surfaced by "Decide one by one",
  // which is not itself a top-level entry — so resolve against the expanded
  // group's members too, not just `entries`.
  const selectedEntry = useMemo<QueueEntry | null>(() => {
    if (!selectedKey) return null;
    for (const entry of entries) {
      if (entryKey(entry) === selectedKey) return entry;
      if (entry.kind === "group" && entry.group_key === expandedGroupKey) {
        for (const member of entry.members) {
          const memberEntry: QueueEntry = { kind: "person", ...member };
          if (entryKey(memberEntry) === selectedKey) return memberEntry;
        }
      }
    }
    return null;
  }, [entries, expandedGroupKey, selectedKey]);

  // Everything reset here is per-row state: a draft, a repeat decision, an
  // exclusion set or a failure notice leaking across a selection change would
  // apply one person's reasoning — or one person's error — to the next.
  const resetRowState = useCallback(() => {
    setDraft(emptyDraft());
    setActiveIdentity(null);
    setLastDecision(null);
    setExcluded(new Set<string>());
    setBulkFailure(null);
    setWriteFailure(null);
  }, []);

  const handleSelect = useCallback(
    (key: string) => {
      setSelectedKey(key);
      resetRowState();
    },
    [resetRowState],
  );

  const handleToggleDecided = useCallback(() => {
    setIncludeDecided((prev) => !prev);
    // The two views are different result sets, so the selected row may not exist
    // in the one being switched to — and a half-typed decision belongs to the row
    // it was started on either way.
    setSelectedKey(null);
    resetRowState();
  }, [resetRowState]);

  const handleToggleMember = useCallback((employee: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(employee)) next.delete(employee);
      else next.add(employee);
      return next;
    });
  }, []);

  const decide = useMutation({
    mutationFn: async (args: DecideArgs): Promise<DecideResponse> =>
      decideFlags({
        identities: args.identities,
        outcome: args.decision.outcome,
        reason: args.decision.reason,
        note: args.decision.note,
        groupKey: args.groupKey ?? null,
        confirm: args.confirm,
      }),
    onSuccess: (result, args) => {
      const effect = decideEffect(result, args);

      if (effect.kind === "confirm") {
        // decide_flags refuses more than DECIDE_CONFIRM_THRESHOLD (25) writes
        // without an explicit confirm. Show the blast radius and re-issue the
        // identical call — never auto-confirm on the user's behalf.
        setPendingConfirm({ args, preview: effect.preview });
        return;
      }

      setPendingConfirm(null);
      setActiveIdentity(null);
      setWriteFailure(null);
      // null only when the call wrote nothing; keep whatever repeat was already
      // on offer rather than clearing a decision that did land earlier.
      if (effect.lastDecision) setLastDecision(effect.lastDecision);
      setBulkFailure(effect.bulkFailure);

      // Refetch rather than patch local state: the rows that failed come back as
      // needs_re_review, and a person only leaves the queue once the server says
      // all their flags are decided.
      refresh();
    },
    // Without this the only write path in the feature fails in complete silence:
    // frappeCall throws on every non-2xx and on the HTML login page Frappe serves
    // under 200 for an expired session, the query client sets mutations.retry
    // false and installs no global handler, so the button would simply re-enable
    // with the page byte-identical and nothing written.
    onError: (err) => {
      setPendingConfirm(null);
      setBulkFailure(null);
      setWriteFailure(extractFrappeError(err, DECIDE_FAILED_MESSAGE));
    },
  });

  const handleSubmit = useCallback(
    (identities: string[], decision: PendingDecision) => {
      if (identities.length === 0) return;
      const groupKey = selectedEntry?.kind === "group" ? selectedEntry.group_key : null;
      decide.mutate({ identities, decision, groupKey });
    },
    [decide, selectedEntry],
  );

  const handleDecideOneByOne = useCallback(() => {
    if (selectedEntry?.kind !== "group") return;
    setExpandedGroupKey(selectedEntry.group_key);
    setSelectedKey(null);
  }, [selectedEntry]);

  const handleCollapseGroup = useCallback(() => {
    if (!expandedGroupKey) return;
    const group = entries.find(
      (entry) => entry.kind === "group" && entry.group_key === expandedGroupKey,
    );
    setExpandedGroupKey(null);
    // The member rows vanish with the expansion, so a selection pointing at one
    // would resolve to nothing and blank the panel. Land back on the group.
    setSelectedKey(group ? entryKey(group) : null);
    resetRowState();
  }, [entries, expandedGroupKey, resetRowState]);

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
    <>
      <FlagQueueView
        // useFlagQueue defaults counts to zeros before the first payload lands,
        // so they are withheld until there is real data: "0 people with
        // something open" beside a failed load reads as "nothing to do", which
        // is the exact false calm this page exists to break.
        counts={isLoading || error ? null : counts}
        includeDecided={includeDecided}
        onToggleDecided={handleToggleDecided}
        truncated={truncated}
        isLoading={isLoading}
        error={error}
        onRetry={refresh}
        bulkFailure={bulkFailure}
        writeFailure={writeFailure}
        alerts={alerts}
        list={
          <FlagQueueList
            entries={entries}
            selectedKey={selectedKey}
            expandedGroupKey={expandedGroupKey}
            onSelect={handleSelect}
            onCollapseGroup={handleCollapseGroup}
          />
        }
        panel={
          <FlagDecisionPanel
            entry={selectedEntry}
            draft={draft}
            onDraftChange={setDraft}
            activeIdentity={activeIdentity}
            onOpenFlag={setActiveIdentity}
            lastDecision={lastDecision}
            onSubmit={handleSubmit}
            excluded={excluded}
            onToggleMember={handleToggleMember}
            onDecideOneByOne={handleDecideOneByOne}
            submitting={decide.isPending}
          />
        }
      />

      <ResponsiveModal
        open={pendingConfirm != null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
        size="sm"
        title="Confirm this decision"
        description={
          pendingConfirm
            ? `${pendingConfirm.preview.count} flags across ${pendingConfirm.preview.employees} employees`
            : null
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPendingConfirm(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => {
                if (pendingConfirm) decide.mutate({ ...pendingConfirm.args, confirm: true });
              }}
            >
              Write {pendingConfirm?.preview.count ?? 0} decisions
            </Button>
          </>
        }
      >
        <p className="px-5 py-4 text-sm text-muted-foreground">
          Decisions are appended, never edited — a later decision supersedes this one and both stay
          on the record.
        </p>
      </ResponsiveModal>
    </>
  );
}

export type FlagQueueViewProps = {
  counts: QueuePayload["counts"] | null;
  /** Whether the queue is also listing people with nothing outstanding. */
  includeDecided?: boolean;
  onToggleDecided?: () => void;
  truncated?: boolean;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  bulkFailure: BulkFailure | null;
  /** A decide call that failed outright — nothing was written. */
  writeFailure?: string | null;
  /** Flagless device outages, straight from Device Closeout Alert. */
  alerts?: QueuePayload["alerts"];
  list: ReactNode;
  panel: ReactNode;
};

/**
 * The page's shell — toolbar counts, split layout, loading and failure states —
 * with no router, no react-query and no data fetching, so it renders under
 * renderToStaticMarkup in the test suite. FlagQueuePage above is the only piece
 * that talks to either.
 */
export function FlagQueueView(props: FlagQueueViewProps) {
  const counts = props.counts;

  return (
    <Page>
      <PageHeader
        title="Flags"
        description={counts ? `${counts.people} people with something open` : "Loading…"}
      >
        {props.truncated ? (
          <p className="text-xs text-brand-accent">
            Showing the first flags in this range — more exist. Narrow the dates to see the rest.
          </p>
        ) : null}

        {/* Open and Needs re-review are counts, not filters — they report the
            size of the job, and letting them hide rows is how a queue starts
            hiding work. Decided is the one exception, and it only ever ADDS:
            pressed, the settled people it counts come back into the list so a
            decision can be replaced. Nothing here can subtract from the queue. */}
        <div
          role="group"
          aria-label="Queue counts"
          className="flex w-full gap-1 rounded-lg bg-muted/40 p-1 sm:w-fit"
        >
          <CountChip label="Open" value={counts?.open ?? 0} />
          <CountChip label="Needs re-review" value={counts?.needs_re_review ?? 0} />
          <CountChip
            label="Decided"
            value={counts?.decided ?? 0}
            pressed={props.includeDecided}
            onToggle={props.onToggleDecided}
          />
        </div>

        {/* Without this the extra rows read as a bug: entries with no action
            left on them, in a queue that promises everything in it is waiting
            on you. */}
        {props.includeDecided ? (
          <p className="text-xs text-muted-foreground">{SHOWING_DECIDED_MESSAGE}</p>
        ) : null}
      </PageHeader>

      {/* Role 2, not role 3: the queue itself loaded fine, so no region is
          missing and there is nothing for FailureBlock to replace — the write
          did not happen and the page is otherwise fully usable. Without this the
          only write path in the feature fails silently. */}
      {props.writeFailure ? (
        <AttentionStrip
          tone="amber"
          icon={<TriangleAlertIcon className="size-4 text-amber-600" aria-hidden="true" />}
        >
          {props.writeFailure}
        </AttentionStrip>
      ) : null}

      {/* Role 2, polite: most of the batch landed, so nothing the user asked for
          is wholly missing and a screen reader must not be interrupted. The
          failing identities live behind the disclosure so the strip stays one
          row at rest. */}
      {props.bulkFailure ? (
        <AttentionStrip
          tone="amber"
          icon={<TriangleAlertIcon className="size-4 text-amber-600" aria-hidden="true" />}
          count={props.bulkFailure.errors.length}
          detail={
            <ul className="space-y-1">
              {props.bulkFailure.errors.map((failure) => (
                <li key={failure.flag_identity} className="text-xs text-muted-foreground">
                  <span className="font-mono">{failure.flag_identity}</span> — {failure.error}
                </li>
              ))}
            </ul>
          }
        >
          {partialFailureMessage(props.bulkFailure.saved, props.bulkFailure.attempted)}
        </AttentionStrip>
      ) : null}

      {/* The only way a flagless outage reaches HR. These come from Device
          Closeout Alert, not from flags: on a deferred_offline or
          closure_failed day the fallback path skips those employees entirely,
          so the queue below is empty for them by construction. No `detail` —
          the alert's `last_error` is engine text that can name a device serial,
          and there is no device↔branch registry to make that claim true. No
          decide action either: there are no flags behind these to decide. */}
      {props.alerts && props.alerts.length > 0 ? (
        <Section>
          <div className="space-y-1.5">
            {props.alerts.map((alert) => (
              <AttentionStrip
                key={`${alert.branch}:${alert.local_date}`}
                tone="amber"
                icon={<CloudOffIcon className="size-4 text-amber-600" aria-hidden="true" />}
              >
                {deviceAlertHeadline(alert)}
              </AttentionStrip>
            ))}
            <p className="px-1 text-xs text-muted-foreground">{DEVICE_ALERT_EXPLAINER}</p>
          </div>
        </Section>
      ) : null}

      <Section grow>
        {props.isLoading ? (
          <EmptyState icon={Spinner} title="Loading flags…" />
        ) : props.error ? (
          // Replaces the region the queue would occupy rather than sitting above
          // it — a page showing both a banner and a replaced region reports one
          // failure twice (components/ui/notice.tsx). min-h-0 because
          // `Section grow` is an overflow-hidden clipper that would otherwise cut
          // the Retry button off on a short viewport.
          <FailureBlock
            title="Flags didn't load"
            cause="Try again, or refresh the page."
            onRetry={props.onRetry}
            className="min-h-0"
          />
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto overscroll-contain">{props.list}</div>
            <div className="min-h-0 overflow-y-auto overscroll-contain">{props.panel}</div>
          </div>
        )}
      </Section>
    </Page>
  );
}

function CountChip(props: {
  label: string;
  value: number;
  /** Present only on a chip that also toggles what the list shows. */
  pressed?: boolean;
  onToggle?: () => void;
}) {
  const body = (
    <>
      {props.label}
      <span className="tabular-nums text-foreground">{props.value}</span>
    </>
  );
  const shape =
    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium sm:flex-none";

  if (!props.onToggle) {
    return <span className={cn(shape, "text-muted-foreground")}>{body}</span>;
  }

  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      onClick={props.onToggle}
      className={cn(
        shape,
        "transition-colors hover:text-foreground",
        props.pressed ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
      )}
    >
      {body}
    </button>
  );
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, Page, PageHeader, Section } from "@lolbikb/dewey-ui";
import { useMutation } from "@tanstack/react-query";
import { differenceInCalendarDays, format, isValid, parseISO, subDays } from "date-fns";
import { CloudOffIcon, TriangleAlertIcon } from "lucide-react";
import { Navigate, useOutletContext, useSearchParams } from "react-router-dom";

import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { AttentionStrip, FailureBlock } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { useFlagQueue, type FlagQueue } from "@/hooks/useFlagQueue";
import type { PendingDecision } from "@/lib/flagDecisionState";
import { buildOutageSet } from "@/lib/flagStrip";
import { extractFrappeError } from "@/lib/frappeError";
import {
  DECIDE_FAILED_MESSAGE,
  DECIDED_TOGGLE_LABEL,
  DEVICE_ALERT_EXPLAINER,
  RANGE_FROM_LABEL,
  RANGE_TO_LABEL,
  REASON_OPTIONS,
  SHOWING_DECIDED_MESSAGE,
  TIER_FILTER_ALL_LABEL,
  TIER_FILTER_LABEL,
  deviceAlertHeadline,
  orphanedEvidenceChangedSummary,
  orphanedFlagGoneSummary,
  partialFailureMessage,
  queueSplitDescription,
  tierLabel,
} from "@/lib/flagQueueLabels";
import {
  partitionQueue,
  queuePeopleCount,
  type OutageGroup,
} from "@/lib/flagQueuePartition";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { cn } from "@/lib/utils";
import { decideFlags } from "@/services/flags";
import type { QueueEntry, QueuePayload, Tier } from "@/types/flags";
import { FlagDecisionPanel } from "@/ui/FlagDecisionPanel";
import { FlagQueueList, entryKey } from "@/ui/FlagQueueList";
import { OutageBand } from "@/ui/OutageBand";

/** get_flag_queue caps a request at QUEUE_MAX_RANGE_DAYS (31); two weeks is the
 *  window HR actually works and keeps the payload well under QUEUE_FLAG_LIMIT. */
const QUEUE_DAYS = 14;

/** The server's own ceiling (flag_queue_api.QUEUE_MAX_RANGE_DAYS). Enforced on
 *  the inputs so an over-long range is refused before it becomes a 417. */
const QUEUE_MAX_RANGE_DAYS = 31;

/**
 * The range and tier live in the URL.
 *
 * They were a module constant and a hard-coded null: the page told HR to "narrow
 * the dates to see the rest" while offering no control that could, and the
 * backend's `tier` parameter — filtered, recounted and tested server-side — was
 * never sent. Putting both in the URL also makes a filtered queue a link
 * somebody can send.
 */
export function clampRange(from: string, to: string): { startDate: string; endDate: string } {
  const start = parseISO(from);
  const end = parseISO(to);
  if (!isValid(start) || !isValid(end) || end < start) return defaultRange();
  // Trim from the START: the recent end is the work that matters, so an
  // over-long range gives up its oldest days rather than today's.
  const span = differenceInCalendarDays(end, start) + 1;
  const clamped = span > QUEUE_MAX_RANGE_DAYS ? subDays(end, QUEUE_MAX_RANGE_DAYS - 1) : start;
  return { startDate: format(clamped, "yyyy-MM-dd"), endDate: format(end, "yyyy-MM-dd") };
}

function defaultRange(): { startDate: string; endDate: string } {
  const today = new Date();
  return {
    startDate: format(subDays(today, QUEUE_DAYS - 1), "yyyy-MM-dd"),
    endDate: format(today, "yyyy-MM-dd"),
  };
}

const TIER_VALUES = ["act", "review", "routine"] as const;

export function parseTierParam(raw: string | null): Tier | null {
  return (TIER_VALUES as readonly string[]).includes(raw ?? "") ? (raw as Tier) : null;
}

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
  /**
   * Which surface issued the write.
   *
   * The band excuses branches; the panel decides a person. Only the panel's
   * write may offer its reason as a repeat or move the selection — a band
   * excuse that set `lastDecision` would put "Excused · Device or data fault"
   * one click away from being applied to an unrelated person's genuine flags.
   */
  source: "panel" | "band";
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

/**
 * The confirmed re-issue of a call the backend refused as too large.
 *
 * "Identical, plus confirm" is the whole contract: the preview the user was
 * shown described THIS call, so any field that changes on the way back makes the
 * blast radius they approved a description of something else. `source` is the
 * one that would bite hardest — a band excuse re-issued as `"panel"` would, on
 * success, offer "Excused · Device or data fault" as the selected person's
 * repeat and drag them to a different row, which is precisely what the
 * discriminant exists to prevent, and only on the over-25 path that the biggest
 * writes always take.
 *
 * Exported and lifted out of the modal's onClick for the reason `decideEffect`
 * and `stripInputs` are: this suite has no react-query harness, so a spread left
 * inline there is a line no test can reach.
 */
export function confirmArgs(args: DecideArgs): DecideArgs {
  return { ...args, confirm: true };
}

/** A fresh draft for a newly selected row. REASON_OPTIONS[0] only seeds the
 *  <select>'s value; nothing is written until HR clicks, and decisionIsComplete
 *  still gates the button. */
function emptyDraft(): PendingDecision {
  return { outcome: "EXCUSED", reason: REASON_OPTIONS[0], note: "" };
}

/**
 * The two strip inputs the list needs, derived from one payload.
 *
 * Exported and kept out of the component body for the same reason `decideEffect`
 * is: this suite renders components with renderToStaticMarkup and has no harness
 * for react-query, so a `buildOutageSet` call left inline here is a line nothing
 * can reach. That matters more than it looks — swapping it for
 * `buildOutageSet([])` would render every unmeasured day emerald, the exact lie
 * the strip's grey state exists to stop, and `tsc` cannot tell the two apart.
 */
export function stripInputs(queue: Pick<FlagQueue, "outageDates" | "range">) {
  return { range: queue.range, outage: buildOutageSet(queue.outageDates) };
}

export function FlagQueuePage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();

  const [searchParams, setSearchParams] = useSearchParams();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const tier = parseTierParam(searchParams.get("tier"));

  const requestedRange = useMemo(
    () => (fromParam && toParam ? clampRange(fromParam, toParam) : defaultRange()),
    [fromParam, toParam],
  );

  // `replace`, not push: dragging a date around should not fill the back button
  // with intermediate ranges the user never meant to visit.
  const setRange = useCallback(
    (next: { startDate: string; endDate: string }) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.set("from", next.startDate);
          params.set("to", next.endDate);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setTier = useCallback(
    (next: Tier | null) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next) params.set("tier", next);
          else params.delete("tier");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Off by default: the queue's job is what is still waiting on HR. Turned on,
  // people who have nothing outstanding come back into the list, which is the
  // only route to a decision HR wants to replace.
  const [includeDecided, setIncludeDecided] = useState(false);

  // `range` here is the payload's own, not `requestedRange`: the strip's window
  // is cut from the range the data actually covers.
  const {
    entries,
    counts,
    alerts,
    orphans,
    outageDates,
    range,
    truncated,
    isLoading,
    error,
    refresh,
  } = useFlagQueue({ ...requestedRange, tier, includeDecided });

  // The queue holds judgments; outages are a precondition and live in a band.
  // Partitioned here rather than in the list so the header can count the two
  // populations separately — "389 people" counted 256 who are waiting on a
  // machine, not on HR.
  const { outages, queue } = useMemo(() => partitionQueue(entries), [entries]);
  const queuePeople = useMemo(() => queuePeopleCount(queue), [queue]);

  const [excludedBranches, setExcludedBranches] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const handleToggleBranch = useCallback((groupKey: string) => {
    setExcludedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  // An exclusion belongs to the outage it was made about, and nothing else does
  // that bookkeeping. `group_key` for a branch outage is stable across months
  // (handleSubmit's comment says so, which is why it must never be sent as a
  // decision's group_key), so a branch unchecked for last week's outage stays
  // unchecked for this week's — and the band is collapsed by default, so the
  // only trace is a smaller number inside a button label.
  //
  // Keyed on the range and tier rather than reset inside their two setters: the
  // URL is the source of truth for both, and it also changes via the back
  // button and via any link somebody was sent. Identity is preserved when the
  // set is already empty, so the overwhelmingly common case does not re-render.
  useEffect(() => {
    setExcludedBranches((prev) => (prev.size === 0 ? prev : new Set<string>()));
  }, [requestedRange.startDate, requestedRange.endDate, tier]);

  // Memoised once for the whole list rather than rebuilt per row: the list
  // re-renders on every keystroke in the decision note, and forty rows would
  // otherwise each rebuild the same set each time.
  const stripProps = useMemo(() => stripInputs({ outageDates, range }), [outageDates, range]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<PendingDecision>(emptyDraft);
  const [activeIdentity, setActiveIdentity] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<PendingDecision | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [bulkFailure, setBulkFailure] = useState<BulkFailure | null>(null);
  const [writeFailure, setWriteFailure] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  /** Spoken, not shown. The queue's own state changes — selection, and the
   *  outcome of a write — were entirely silent to assistive tech. */
  const [announcement, setAnnouncement] = useState("");
  /**
   * Where to land after a write. Deciding a row removes it, which unmounted the
   * focused button and dropped focus to <body> — so a keyboard user was
   * returned to the top of the document and had to walk back down, and the
   * panel silently reverted to its empty state with no statement that anything
   * had been saved.
   *
   * `from` is the entry array as it was at submit time. react-query hands back a
   * new array on new data, so comparing identity is how we tell "the refetch has
   * landed" from "this effect ran on the pre-refetch render" — acting on the
   * latter would re-select the row that was just decided.
   */
  const [restore, setRestore] = useState<{ index: number; from: QueueEntry[] } | null>(null);
  /** Handed to the list, which focuses this row once and reports back. */
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // The selected row can be a group member surfaced by "Decide one by one",
  // which is not itself a top-level entry — so resolve against the expanded
  // group's members too, not just the top-level rows.
  //
  // `queue`, not `entries`: an outage is not selectable, because the list does
  // not render one. Resolving against `entries` let a stale or mis-aimed
  // selection land on an outage group and open the decision panel over it — a
  // judgment form for a dead card reader, which is the precondition this page
  // now refuses to judge.
  const selectedEntry = useMemo<QueueEntry | null>(() => {
    if (!selectedKey) return null;
    for (const entry of queue) {
      if (entryKey(entry) === selectedKey) return entry;
      if (entry.kind === "group" && entry.group_key === expandedGroupKey) {
        for (const member of entry.members) {
          const memberEntry: QueueEntry = { kind: "person", ...member };
          if (entryKey(memberEntry) === selectedKey) return memberEntry;
        }
      }
    }
    return null;
  }, [queue, expandedGroupKey, selectedKey]);

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

  /**
   * Cancel a pending post-write restore.
   *
   * Every deliberate move the user makes while a write is in flight has to call
   * this: their choice wins, and a restore left armed would yank them off the
   * row they just chose when the refetch lands. Shared rather than repeated so
   * a fourth navigation path cannot quietly omit it — which is exactly how the
   * first three came to differ.
   */
  const cancelRestore = useCallback(() => setRestore(null), []);

  const handleSelect = useCallback(
    (key: string) => {
      setSelectedKey(key);
      resetRowState();
      cancelRestore();
    },
    [resetRowState, cancelRestore],
  );

  const handleToggleDecided = useCallback(() => {
    setIncludeDecided((prev) => !prev);
    // The two views are different result sets, so the selected row may not exist
    // in the one being switched to — and a half-typed decision belongs to the row
    // it was started on either way.
    setSelectedKey(null);
    resetRowState();
    cancelRestore();
  }, [resetRowState, cancelRestore]);

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
      // The open flag form belongs to the selected person, so it closes when
      // THEIR write lands and not when the band's does. Same rule as the two
      // gates below, and the same sequence reaches it: a half-typed decision
      // should not snap shut because somebody acknowledged an outage.
      if (args.source === "panel") setActiveIdentity(null);
      setWriteFailure(null);
      // null only when the call wrote nothing; keep whatever repeat was already
      // on offer rather than clearing a decision that did land earlier.
      //
      // Panel writes only. A band excuse announces and refreshes; it must not
      // touch anything scoped to the selected row. Offering "Excused · Device
      // or data fault" as this person's repeat, when the write was about a
      // branch's dead reader and not about them at all, is resetRowState's own
      // stated failure — one person's reasoning applied to the next — arriving
      // by a path resetRowState cannot intercept, because no selection changed.
      if (effect.lastDecision && args.source === "panel") setLastDecision(effect.lastDecision);
      setBulkFailure(effect.bulkFailure);

      // Say what happened. Until now the only signal that a decision landed was
      // the row vanishing — invisible to a screen reader, and ambiguous to
      // everyone else, since a row also vanishes when the refetch reorders.
      // The zero-width space alternates, so two consecutive identical outcomes
      // still change the text node. Without it React bails out on the equal
      // string, the DOM never mutates, and a live region announces nothing —
      // every save after the first would be silent, which is the exact silence
      // this is here to end, in the decide -> next loop the feature exists for.
      setAnnouncement((previous) => {
        const text = effect.bulkFailure
          ? `Saved ${effect.bulkFailure.saved} of ${effect.bulkFailure.attempted}. See the failures below.`
          : "Decision saved.";
        return previous.endsWith("\u200b") ? text : `${text}\u200b`;
      });

      // Remember the SLOT, not the row: the row is about to stop existing.
      // Landing on whatever takes its place turns the core loop into
      // decide -> next instead of decide -> lost.
      //
      // Armed only when something was actually written. A zero-write call (a
      // bulk attempt where every identity failed) leaves the queue unchanged, so
      // react-query's structural sharing hands back a reference-identical array
      // and the guard below never fires — the request would sit armed until some
      // unrelated refetch (this query is staleTime 0 with refetchOnWindowFocus)
      // finally changed the data, then steal focus and clobber the selection at
      // an arbitrary moment, possibly mid-note.
      //
      // Panel writes only, for the second time on this handler and for a
      // different reason: a band excuse removes N outage entries, so every later
      // slot shifts. With thirteen branches down the user is carried from row i
      // to row i+13, focus follows, and the draft they were part-way through —
      // including its free-text note — is wiped. They asked to acknowledge an
      // outage, not to leave the row they were working on.
      if (effect.lastDecision && args.source === "panel") {
        // Members of an expanded group are not top-level entries, so fall back to
        // the group that owns the selected member — that is the row the list
        // renders in its place.
        const index = queue.findIndex(
          (entry) =>
            entryKey(entry) === selectedKey ||
            (entry.kind === "group" &&
              entry.members.some(
                (member) => entryKey({ kind: "person", ...member }) === selectedKey,
              )),
        );
        setRestore(index >= 0 ? { index, from: queue } : null);
      }

      // The branches just excused are about to leave the queue, so the choice of
      // which ones to include has nothing left to describe. Left standing it
      // would silently narrow the next outage's write. Same "something was
      // actually written" guard as the restore above: a call that wrote nothing
      // has not settled anything, and the user's selection is still the one they
      // will want when they retry.
      if (effect.lastDecision && args.source === "band") setExcludedBranches(new Set<string>());

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

  useEffect(() => {
    if (!restore) return;
    if (queue === restore.from) return; // the refetch has not landed yet
    setRestore(null);
    // Clamped: deciding the last row leaves the slot past the end, and the row
    // above it is where a human would look next.
    const next = queue[Math.min(restore.index, queue.length - 1)];
    if (!next) {
      setSelectedKey(null);
      return;
    }
    const key = entryKey(next);
    setSelectedKey(key);
    // Landing on a row is a selection change, so it owes the same reset every
    // other selection change does. Without it the decided person's draft —
    // outcome, reason and the free-text NOTE — and their exclusion set arrive
    // pre-filled on the next person's form, which is resetRowState's own stated
    // error: one person's reasoning applied to the next.
    //
    // Not the whole of resetRowState: `lastDecision` is what powers "same reason
    // applies" (the entire point of landing here), and `bulkFailure` /
    // `writeFailure` describe the write that just happened and must outlive it.
    setDraft(emptyDraft());
    setActiveIdentity(null);
    setExcluded(new Set<string>());
    setFocusKey(key);
  }, [restore, queue]);

  const handleSubmit = useCallback(
    (identities: string[], decision: PendingDecision) => {
      if (identities.length === 0) return;
      // No groupKey: the server mints a fresh `AFD-<hash>` per call.
      //
      // A decision's group_key answers "which writes happened together, so which
      // ones does reverse_decision_group undo together" — it is a batch id, not a
      // name for the queue row the batch came from. Passing the entry's group_key
      // conflated the two, and reversal supersedes EVERY live row sharing the key:
      // two separate decisions on one group already collapsed into a single
      // undo. Now that a branch outage is one entry spanning the whole range
      // rather than one per day, that key would be stable across months, so
      // undoing this morning's call would silently reverse every device-fault
      // decision ever made for that branch.
      decide.mutate({ identities, decision, groupKey: null, source: "panel" });
    },
    [decide],
  );

  // Routed through the same mutation as every other write, so the band inherits
  // the needs_confirm -> blast-radius preview -> re-issue-with-confirm flow:
  // decide_flags refuses more than DECIDE_CONFIRM_THRESHOLD (25) writes without
  // one, and an "Excuse all" over thirteen branches is the largest write this
  // page can start.
  //
  // groupKey: null for the reason handleSubmit spells out above — the server
  // mints a fresh AFD-<hash> per call, and passing the band's own key would make
  // reverse_decision_group undo every device-fault decision ever recorded for
  // those branches.
  const handleExcuseOutages = useCallback(
    (identities: string[]) => {
      if (identities.length === 0) return;
      decide.mutate({
        identities,
        decision: { outcome: "EXCUSED", reason: "DEVICE_OR_DATA_FAULT", note: "" },
        groupKey: null,
        source: "band",
      });
    },
    [decide],
  );

  const handleDecideOneByOne = useCallback(() => {
    if (selectedEntry?.kind !== "group") return;
    setExpandedGroupKey(selectedEntry.group_key);
    setSelectedKey(null);
    cancelRestore();
  }, [selectedEntry, cancelRestore]);

  const handleCollapseGroup = useCallback(() => {
    if (!expandedGroupKey) return;
    // `queue` for the same reason as everywhere else: this looks up a row the
    // list is rendering, and `entries` is the payload. Equivalent today, since
    // an expansion can only start from `selectedEntry` and an outage can never
    // be selected — but it was the last lookup in this component still reaching
    // past the partition, which is precisely the shape of the bug above.
    const group = queue.find(
      (entry) => entry.kind === "group" && entry.group_key === expandedGroupKey,
    );
    setExpandedGroupKey(null);
    // The member rows vanish with the expansion, so a selection pointing at one
    // would resolve to nothing and blank the panel. Land back on the group.
    setSelectedKey(group ? entryKey(group) : null);
    resetRowState();
    cancelRestore();
  }, [queue, expandedGroupKey, resetRowState, cancelRestore]);

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
        // Withheld on the same terms as counts, and for the same reason: the
        // hook zero-fills before the first payload, and a stale-looking orphan
        // line beside a failed load is worse than none.
        orphans={isLoading || error ? undefined : orphans}
        includeDecided={includeDecided}
        onToggleDecided={handleToggleDecided}
        announcement={announcement}
        range={requestedRange}
        onRangeChange={setRange}
        tier={tier}
        onTierChange={setTier}
        truncated={truncated}
        isLoading={isLoading}
        error={error}
        onRetry={refresh}
        bulkFailure={bulkFailure}
        writeFailure={writeFailure}
        alerts={alerts}
        outages={outages}
        queuePeople={queuePeople}
        queueRows={queue.length}
        excludedBranches={excludedBranches}
        onToggleBranch={handleToggleBranch}
        onExcuseOutages={handleExcuseOutages}
        // Narrowed to the band's own write, not a bare `decide.isPending`. The
        // mutation is shared with the panel, so the unqualified flag would put
        // "Excusing…" on the band every time somebody decided a single person —
        // telling them a mass excuse was under way when they had asked for
        // nothing of the sort. This still closes the hazard the flag is for: a
        // second click on the band while the band's own write is in flight.
        excusing={decide.isPending && decide.variables?.source === "band"}
        list={
          <FlagQueueList
            entries={queue}
            {...stripProps}
            selectedKey={selectedKey}
            expandedGroupKey={expandedGroupKey}
            onSelect={handleSelect}
            onCollapseGroup={handleCollapseGroup}
            focusKey={focusKey}
            onFocusHandled={() => setFocusKey(null)}
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
                if (pendingConfirm) decide.mutate(confirmArgs(pendingConfirm.args));
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
  /** Spoken-only status text for the queue's live region. */
  announcement?: string;
  /** The range the controls edit — the request, not the payload's answer. */
  range: { startDate: string; endDate: string };
  onRangeChange: (next: { startDate: string; endDate: string }) => void;
  tier: Tier | null;
  onTierChange: (next: Tier | null) => void;
  truncated?: boolean;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  bulkFailure: BulkFailure | null;
  /** A decide call that failed outright — nothing was written. */
  writeFailure?: string | null;
  /** Flagless device outages, straight from Device Closeout Alert. */
  alerts?: QueuePayload["alerts"];
  /**
   * Decisions that no longer match a live flag. Reported, never actionable:
   * the queue lists flags, and by definition these have none to list.
   *
   * They are shown because the identity scheme trades durability for
   * precision — correcting a punch under a MISSING_TIME or ATTENDANCE_ISSUE
   * flag changes its identity, so the decision attached to it orphans. The
   * design doc parks that trade with "revisit if orphan rates in practice
   * turn out to be high", which is only answerable if the rate is visible.
   */
  orphans?: QueuePayload["orphans"];
  /** Device outages, partitioned out of the queue. Empty on a healthy day. */
  outages: OutageGroup[];
  /** Distinct people in the judgment queue — NOT `counts.people`, which includes outage members. */
  queuePeople: number;
  /** Top-level rows in the judgment queue — NOT `counts.rows`, which counts the
   *  outage groups too. This is `partitionQueue(...).queue.length`. */
  queueRows: number;
  excludedBranches: ReadonlySet<string>;
  onToggleBranch: (groupKey: string) => void;
  onExcuseOutages: (identities: string[]) => void;
  /** A band excuse is in flight — NOT any write. Disables the band's button and
   *  is the only thing that may make it say "Excusing…". */
  excusing?: boolean;
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

  // Each line only when its own count is non-zero — reporting "0 decisions no
  // longer have a matching flag" is noise on the overwhelmingly common day.
  const orphanLines = [
    props.orphans?.orphaned_flag_gone
      ? orphanedFlagGoneSummary(props.orphans.orphaned_flag_gone)
      : null,
    props.orphans?.orphaned_evidence_changed
      ? orphanedEvidenceChangedSummary(props.orphans.orphaned_evidence_changed)
      : null,
  ].filter((line): line is string => line !== null);

  // Everyone the outage touched, counted the same way the band's own headline
  // counts them. NOT `counts.people`, which counts both populations together and
  // so cannot answer either question — and NOT
  // `outageWrite(...).coveredEmployeeCount`, which counts only members holding an
  // undecided flag and therefore falls towards zero as the excuse lands. The
  // header would then report nobody waiting on a device fault while the band
  // directly above it still names thirteen branches.
  const outagePeople = queuePeopleCount(props.outages);

  return (
    // max-w-none: dewey-ui's Page caps at max-w-7xl so "pages across both apps
    // share the same content width", which is right for a form and wrong here.
    // At 1512 the cap plus padding threw away 296px; at 1920, 704px — 36.7% of
    // the monitor — on the one page where width converts directly into rows
    // that stop truncating. cn() is twMerge, so this beats the default.
    <Page className="max-w-none">
      <PageHeader
        title="Flags"
        description={
          counts
            ? queueSplitDescription(props.queuePeople, props.queueRows, outagePeople)
            : "Loading…"
        }
        actions={
          // One row, inline, no stacked labels. The three controls previously
          // cost 62px because each carried a <Label> above it; the accessible
          // name moves onto the control itself, which is where a screen reader
          // reads it from anyway.
          //
          // `max-w-[calc(100vw-16rem)] … lg:max-w-none`, not the plain
          // `flex-wrap` the width alone would suggest: `actions` renders
          // inside dewey-ui's own `shrink-0` sibling of the title (page.tsx),
          // which never gets asked to shrink and has no responsive stacking of
          // its own — so on a phone this row's unwrapped intrinsic width
          // (~575px measured at a 412px viewport) became this flex item's
          // PREFERRED size regardless of `flex-wrap` on its own children, and
          // `justify-between` took the entire deficit out of the title, down
          // to 0 width. `max-w` is a hard clamp browsers honour over a flex
          // item's preferred size even at `shrink-0`, and a `calc(100vw-…)`
          // expression resolves against the viewport rather than this flex
          // item's own (circular) auto-sizing — so it forces the real wrap
          // `flex-wrap` was already meant to do. A fixed 16rem title column
          // (not a fraction like `56vw`) is what keeps that from conceding
          // chrome at the mid-size desktop widths this page is actually
          // measured at — `56vw` bit from ~1027px down against this row's
          // ~575px natural width, wrapping and costing ~48px even at a 900px
          // viewport with 300+px of genuine slack beside the title. Released
          // entirely at `lg` (1024px) and up, where dewey-ui's own `Page`
          // padding step (`sm:px-8`) has already landed and there is always
          // room. Regressing this clamp is caught by
          // e2e/flags.spec.ts's "the flag queue renders groups and person
          // rows with toolbar counts for HR staff", run under Playwright's
          // `mobile` project — remove it and the header's description goes
          // `hidden` there, squeezed to 0 width behind an unwrapped toolbar.
          <div className="flex max-w-[calc(100vw-16rem)] flex-wrap items-center gap-2 lg:max-w-none">
            <DatePickerInput
              ariaLabel={RANGE_FROM_LABEL}
              value={props.range.startDate}
              max={parseISO(props.range.endDate)}
              onChange={(value) => props.onRangeChange({ ...props.range, startDate: value })}
              className="w-36 space-y-0"
            />
            <span className="text-muted-foreground" aria-hidden="true">
              –
            </span>
            <DatePickerInput
              ariaLabel={RANGE_TO_LABEL}
              value={props.range.endDate}
              min={parseISO(props.range.startDate)}
              onChange={(value) => props.onRangeChange({ ...props.range, endDate: value })}
              className="w-36 space-y-0"
            />
            <select
              aria-label={TIER_FILTER_LABEL}
              value={props.tier ?? ""}
              onChange={(event) => props.onTierChange(parseTierParam(event.target.value))}
              className="h-10 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">{TIER_FILTER_ALL_LABEL}</option>
              {TIER_VALUES.map((value) => (
                <option key={value} value={value}>
                  {tierLabel(value)}
                </option>
              ))}
            </select>
            {/* The one count that was ever a control. Open and Needs re-review
                reported the size of the job and could not be pressed; Open has
                moved into the description line and Needs re-review has read 0
                on every day of this queue's life. */}
            <button
              type="button"
              aria-pressed={props.includeDecided ?? false}
              onClick={props.onToggleDecided}
              className={cn(
                "flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
                props.includeDecided
                  ? "border-primary/30 bg-primary/5 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {DECIDED_TOGGLE_LABEL}
              <span className="tabular-nums text-foreground">{counts?.decided ?? 0}</span>
            </button>
          </div>
        }
      >
        {/* Without this the extra rows read as a bug: entries with no action
            left on them, in a queue that promises everything in it is waiting
            on you. */}
        {props.includeDecided ? (
          <p className="text-xs text-muted-foreground">{SHOWING_DECIDED_MESSAGE}</p>
        ) : null}

        {orphanLines.length > 0 ? (
          <div className="space-y-0.5">
            {orphanLines.map((line) => (
              <p key={line} className="text-xs text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </PageHeader>

      {/* Above the queue and outside it: an outage is the precondition that
          explains the rows below, and it is not a judgment about anybody. Self-
          hiding when there is no outage, so a healthy day looks exactly as it
          did before.

          Withheld on a failed load for the same reason `counts` and `orphans`
          are one level up, and with more at stake than either: react-query keeps
          the last good `data` when a refetch fails, so the entries behind this
          band can outlive the payload they came from — and unlike a stale count,
          this band is the page's largest WRITE. "Excuse 157 people" sitting
          above "Flags didn't load" invites a mass decision over data the page
          has just said it could not load. */}
      {props.isLoading || props.error ? null : (
        <OutageBand
          outages={props.outages}
          excludedBranches={props.excludedBranches}
          onToggleBranch={props.onToggleBranch}
          onExcuse={props.onExcuseOutages}
          submitting={props.excusing}
        />
      )}

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
          // Below lg this is ONE scroll surface, not two stacked ones. As a grid
          // it was two implicit auto rows in a definite-height container, and
          // `min-h-0` on both children drops their min-content contribution to
          // zero — so the tracks split the height evenly and a phone got a ~133px
          // window onto 252 rows, shearing the third row through its sub-line
          // while an unasked-for empty panel took the other half.
          //
          // The split starts at lg, not md: at 768px the panel would be 340px,
          // narrower than the list beside it, and the decision form does not fit
          // that. useIsMobile.ts:9 already puts the data table's break at lg.
          //
          // 24–30rem rather than a flat 22rem cap. The row's fixed chrome (avatar,
          // gaps, +N badge, 117px strip) is ~240px, so 22rem left 112px for two
          // lines of text and the name — the row's identity — was the only
          // shrinkable thing in it, collapsing to "B…" beside a shrink-0 badge.
          // The panel gives up width it measurably was not using: its longest
          // line of prose ends ~277px short of the old edge.
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain",
              "lg:grid lg:overflow-visible lg:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)]",
            )}
          >
            {/* polite, not assertive: these confirm what the user just did, so
                they must not cut across whatever is being read. Visually hidden
                because the same facts are already on screen. */}
            <p className="sr-only" role="status" aria-live="polite">
              {props.announcement}
            </p>
            <div className="lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">{props.list}</div>
            <div
              role="region"
              aria-label="Selected flag"
              className="lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"
            >
              {props.panel}
            </div>
          </div>
        )}
      </Section>
    </Page>
  );
}

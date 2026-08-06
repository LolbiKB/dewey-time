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
import {
  DEVICE_ALERT_EXPLAINER,
  REASON_OPTIONS,
  deviceAlertHeadline,
  partialFailureMessage,
} from "@/lib/flagQueueLabels";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
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

type DecideArgs = {
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
type DecideResponse = {
  ok?: boolean;
  written?: number;
  group_key?: string;
  errors?: { flag_identity: string; error: string }[];
  needs_confirm?: boolean;
  preview?: { count: number; employees: number };
};

type PendingConfirm = { args: DecideArgs; preview: { count: number; employees: number } };

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

  const { entries, counts, alerts, truncated, isLoading, error, refresh } = useFlagQueue(range);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<PendingDecision>(emptyDraft);
  const [activeIdentity, setActiveIdentity] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<PendingDecision | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [bulkFailure, setBulkFailure] = useState<BulkFailure | null>(null);
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

  const handleSelect = useCallback((key: string) => {
    // Everything below is per-row state: a draft, a repeat decision or an
    // exclusion set leaking across a selection change would apply one person's
    // reasoning to the next.
    setSelectedKey(key);
    setDraft(emptyDraft());
    setActiveIdentity(null);
    setLastDecision(null);
    setExcluded(new Set<string>());
    setBulkFailure(null);
  }, []);

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
      if (result.needs_confirm) {
        // decide_flags refuses more than DECIDE_CONFIRM_THRESHOLD (25) writes
        // without an explicit confirm. Show the blast radius and re-issue the
        // identical call — never auto-confirm on the user's behalf.
        setPendingConfirm({
          args,
          preview: result.preview ?? { count: args.identities.length, employees: 0 },
        });
        return;
      }

      setPendingConfirm(null);
      setActiveIdentity(null);
      setLastDecision(args.decision);

      const errors = result.errors ?? [];
      setBulkFailure(
        errors.length > 0
          ? { saved: result.written ?? 0, attempted: args.identities.length, errors }
          : null,
      );

      // Refetch rather than patch local state: the rows that failed come back as
      // needs_re_review, and a person only leaves the queue once the server says
      // all their flags are decided.
      refresh();
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
        truncated={truncated}
        isLoading={isLoading}
        error={error}
        onRetry={refresh}
        bulkFailure={bulkFailure}
        alerts={alerts}
        list={
          <FlagQueueList
            entries={entries}
            selectedKey={selectedKey}
            expandedGroupKey={expandedGroupKey}
            onSelect={handleSelect}
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
  truncated?: boolean;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  bulkFailure: BulkFailure | null;
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

        {/* Counts, not filters. They report the size of the job; making them
            silently filter the list is how a queue starts hiding work. */}
        <div
          role="group"
          aria-label="Queue counts"
          className="flex w-full gap-1 rounded-lg bg-muted/40 p-1 sm:w-fit"
        >
          <CountChip label="Open" value={counts?.open ?? 0} />
          <CountChip label="Needs re-review" value={counts?.needs_re_review ?? 0} />
          <CountChip label="Decided" value={counts?.decided ?? 0} />
        </div>
      </PageHeader>

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

function CountChip(props: { label: string; value: number }) {
  return (
    <span className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground sm:flex-none">
      {props.label}
      <span className="tabular-nums text-foreground">{props.value}</span>
    </span>
  );
}

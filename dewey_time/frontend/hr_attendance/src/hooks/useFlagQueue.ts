import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { queryKeys } from "@/lib/queryKeys";
import { getFlagQueue } from "@/services/flags";
import type { QueuePayload, Tier } from "@/types/flags";

const EMPTY_COUNTS: QueuePayload["counts"] = {
  open: 0,
  needs_re_review: 0,
  open_capped: false,
  decided: 0,
  people: 0,
  rows: 0,
};

const EMPTY_ORPHANS: QueuePayload["orphans"] = {
  orphaned_flag_gone: 0,
  orphaned_evidence_changed: 0,
};

export type FlagQueueParams = {
  startDate: string;
  endDate: string;
  tier?: Tier | null;
  /** Include people whose flags are all decided, so HR can replace a decision. */
  includeDecided?: boolean;
};

export type FlagQueue = {
  entries: QueuePayload["entries"];
  counts: QueuePayload["counts"];
  orphans: QueuePayload["orphans"];
  alerts: QueuePayload["alerts"];
  /** (branch, date) pairs with no device data — the flag strip's grey cells. */
  outageDates: QueuePayload["outage_dates"];
  /**
   * The range the payload actually covers, falling back to the one requested.
   * The strip's window is cut from its recent end, so it has to be the server's
   * answer rather than the client's question wherever the two can differ.
   */
  range: { startDate: string; endDate: string };
  /**
   * Rollout phases for the requested range, or undefined while loading.
   * Handed through raw: all the copy and the null-date rules live in
   * lib/rolloutBanner, tested there rather than in a hook.
   */
  rollout: QueuePayload["rollout"] | undefined;
  truncated: boolean;
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
};

export function useFlagQueue(params: FlagQueueParams): FlagQueue {
  const { startDate, endDate, tier = null, includeDecided = false } = params;

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.flags.queue(startDate, endDate, tier, includeDecided),
    queryFn: () => getFlagQueue({ startDate, endDate, tier, includeDecided }),
  });

  return useMemo(
    () => ({
      entries: data?.entries ?? [],
      counts: data?.counts ?? EMPTY_COUNTS,
      orphans: data?.orphans ?? EMPTY_ORPHANS,
      alerts: data?.alerts ?? [],
      // `?? []` is for the pre-first-payload render, where `data` is undefined —
      // the same reason as every other line in this block. A *present* payload
      // always carries the key: the cache prefix is versioned by payload shape
      // (flag_queue_api.py's `_QUEUE_CACHE_PREFIX`), so no pre-deploy entry
      // written under an older shape survives into new code.
      outageDates: data?.outage_dates ?? [],
      range: {
        startDate: data?.start_date ?? startDate,
        endDate: data?.end_date ?? endDate,
      },
      rollout: data?.rollout,
      truncated: data?.truncated ?? false,
      isLoading,
      error,
      refresh: () => void refetch(),
    }),
    [data, startDate, endDate, isLoading, error, refetch],
  );
}

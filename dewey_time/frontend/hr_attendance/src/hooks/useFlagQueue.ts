import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { queryKeys } from "@/lib/queryKeys";
import { getFlagQueue } from "@/services/flags";
import type { QueuePayload, Tier } from "@/types/flags";

const EMPTY_COUNTS: QueuePayload["counts"] = {
  open: 0,
  needs_re_review: 0,
  decided: 0,
  people: 0,
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
      truncated: data?.truncated ?? false,
      isLoading,
      error,
      refresh: () => void refetch(),
    }),
    [data, isLoading, error, refetch],
  );
}

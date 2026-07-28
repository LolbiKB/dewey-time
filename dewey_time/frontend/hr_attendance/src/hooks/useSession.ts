import { useQuery } from "@tanstack/react-query";

import { frappeCall } from "@/lib/frappe";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Drop-in replacement for frappe-react-sdk's useFrappeAuth().
 *
 * Returns the logged-in user id, or null for an unauthenticated session. Guest
 * is normalised to "Guest" by Frappe itself, and callers already treat that as
 * signed-out (`!currentUser || currentUser === "Guest"`), so it is passed
 * through unchanged rather than mapped to null.
 *
 * Keyed under `session.user()`, not `session.all` — that key already belongs to
 * useCalendarSession, and sharing it would mean sharing one cache entry between
 * two unrelated payloads.
 */
export function useSession() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.session.user(),
    queryFn: () => frappeCall<string>("frappe.auth.get_logged_user"),
    // Deliberate, and narrower than queryClient's 4xx-aware default. A
    // signed-out session arrives either as a 403 (which that default already
    // declines to retry) or as the login page Frappe serves with a 200, which
    // frappeCall surfaces as a non-4xx error and the default *would* retry
    // twice with backoff — seconds of spinner in place of the sign-in card.
    // e2e/signed-out.spec.ts pins this by request count: 1 with it, 3 without.
    retry: false,
  });

  return { currentUser: data ?? null, isLoading };
}

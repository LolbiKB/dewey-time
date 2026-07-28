import { useQuery } from "@tanstack/react-query";

import { frappeCall } from "@/lib/frappe";
import { sessionProbeRetry } from "@/lib/queryClient";
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
    retry: sessionProbeRetry,
  });

  return { currentUser: data ?? null, isLoading };
}

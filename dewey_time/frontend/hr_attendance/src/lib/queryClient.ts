import { QueryClient } from "@tanstack/react-query";

import { FrappeCallError } from "@/lib/frappe";

/**
 * Follows ADMS's freshness strategy (frontend/adms/src/App.tsx:27-46) so both
 * apps behave identically where it matters to the user: data is stale
 * immediately (always revalidate on mount) but stays cached for 5 minutes, and
 * refetches when the user returns to the tab or the network reconnects.
 *
 * It deliberately diverges from ADMS on retry, both times in the safer
 * direction — see the comments below. ADMS is a read-mostly device dashboard;
 * this app writes Shift Assignments and deletes schedules, so a retry here has
 * consequences a dashboard refetch does not.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 1000 * 60 * 5,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // 4xx is the server's verdict, not a blip: a 403 session-expiry or a 417
      // frappe.throw() is re-issued pointlessly and delays the message the user
      // needs. FrappeCallError.status exists to discriminate exactly this.
      retry: (count, err) =>
        !(err instanceof FrappeCallError && err.status >= 400 && err.status < 500) && count < 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Deliberately NOT ADMS's retry:1. Our mutations create Shift Assignments
      // and delete schedules; a retry after a commit-then-drop duplicates them.
      // This is react-query's own default.
      retry: false,
      retryDelay: 1000,
    },
  },
});

/**
 * Retry policy for the two session probes (useSession, useCalendarSession),
 * which diverges from the query default above in both directions.
 *
 * Narrower: an expired Frappe session arrives as the login *page* under HTTP
 * 200, which frappeCall surfaces as a FrappeCallError with status 200
 * (frappe.ts:80-85). That is not 4xx, so the default would retry it — a backoff
 * spent on a verdict that cannot change, showing a spinner where the sign-in
 * card belongs. `status < 500` declines that, and the 403 case with it.
 *
 * Wider: these probes gate every route, and they are a real request — the
 * frappe-react-sdk version this replaced read a cookie and could not fail — so
 * they can fail for reasons that are not a verdict. The gate cannot tell the
 * difference, because useSession collapses "signed out" and "the probe failed"
 * to the same `currentUser: null`. Without a retry, one dropped request on
 * first paint tells a signed-in user they are signed out and leaves them there.
 * So a 5xx, or a network TypeError that is not a FrappeCallError at all, buys
 * exactly one more attempt.
 *
 * Still no 4xx retries and still nothing for mutations, per the ruled policy.
 * e2e/signed-out.spec.ts pins both halves by request count: 1 for the 200, 2
 * for the 500.
 */
export const sessionProbeRetry = (count: number, err: unknown): boolean =>
  count < 1 && !(err instanceof FrappeCallError && err.status < 500);

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

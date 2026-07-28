import { QueryClient } from "@tanstack/react-query";

/**
 * Matches ADMS's configuration (frontend/adms/src/App.tsx:27-46) so both apps
 * behave identically: data is stale immediately (always revalidate on mount)
 * but stays cached for 5 minutes, and refetches when the user returns to the
 * tab or the network reconnects.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 1000 * 60 * 5,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter as Router } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './hooks/use-auth.tsx'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { Toaster } from './components/ui/sonner'

// Get Google Client ID from environment
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

// Create a client for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      retry: (failureCount, error) => {
        // Don't retry on 401/403 errors
        if (error instanceof Error && error.message.includes("401"))
          return false;
        if (error instanceof Error && error.message.includes("403"))
          return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: false,
    },
  },
});

// Initialize auth state before rendering - check localStorage synchronously
const initializeAndRender = () => {
  // Check localStorage synchronously (instant)
  const storedUser = localStorage.getItem('diu_user_session');
  const storedToken = localStorage.getItem('diu_auth_token');

  // If no auth data, clear any stale entries
  if (!storedUser || !storedToken) {
    localStorage.removeItem('diu_user_session');
    localStorage.removeItem('diu_auth_token');
    localStorage.removeItem('diu_last_auth_check');
  }

  // Render immediately - let TanStack Query validate in background
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
          <Router>
            <AuthProvider>
              <App />
              <Toaster />
              <ReactQueryDevtools initialIsOpen={false} />
            </AuthProvider>
          </Router>
        </GoogleOAuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
};

// Initialize and render immediately - no await!
initializeAndRender();
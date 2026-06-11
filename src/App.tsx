import { ThemeProvider } from 'next-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { BrowserRouter, HashRouter, Routes, Route, useLocation, Link, Navigate } from 'react-router-dom'
import { isFrappeMode } from '@/lib/auth-mode'
import { AttendanceLogs } from './pages/AttendanceLogs'
import { Devices } from './pages/Devices'
import { Users } from './pages/Users'
import { LoginPage } from './pages/Login'
import { AuthProvider, useAuth } from '@/contexts/auth-context'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Loader2, LogOut, CalendarCheck, Users as UsersIcon, Fingerprint } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { AppShell, type ShellNavMode } from '@lolbikb/dewey-ui'
import { HeaderConnection } from '@/components/header-connection'
import { HeaderDeviceStatus } from '@/components/header-device-status'
import { useRealtimeDevices } from '@/hooks/use-core-data'

// AppShell is router-agnostic; adapt react-router's Link to its href contract.
const RouterLink = ({ href, ...props }: React.ComponentProps<'a'> & { href: string }) => (
  <Link to={href} {...props} />
)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data freshness strategy:
      // - Stale immediately (always refetch on mount if needed)
      // - But keep in cache for 5 minutes (gcTime)
      staleTime: 0,
      gcTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: true, // Refetch when user returns to app
      refetchOnReconnect: true, // Refetch when network reconnects
      retry: 2,
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Retry mutations once on network errors
      retry: 1,
      retryDelay: 1000,
    },
  },
})

const routeTitles: Record<string, string> = {
  '/users': 'User Management',
  '/attendance-logs': 'Attendance Logs',
  '/devices': 'Device Management',
}

function AppContent() {
  const location = useLocation()
  const pageTitle = routeTitles[location.pathname] || 'User Management'
  const isUsersHome = location.pathname === '/users'
  const { user, isAdmin, loading, isAdminLoading, signOut } = useAuth()

  // Global realtime for devices - available to all pages
  useRealtimeDevices()

  // Show loading spinner while checking initial auth
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // Show login page if not authenticated
  if (!user) {
    return <LoginPage />
  }

  // Show loading spinner while checking admin status (prevents Access Denied flash)
  if (isAdminLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // Show access denied if not admin
  if (!isAdmin) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to access this application.</p>
          <p className="text-sm text-muted-foreground">Logged in as: {user.email}</p>
          <Button onClick={signOut} variant="outline">
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>
    )
  }

  const navMode: ShellNavMode = {
    type: 'sidebar',
    label: 'Platform',
    groups: [
      {
        title: 'Management',
        icon: UsersIcon,
        items: [
          { title: 'User Management', href: '/users', active: location.pathname === '/users' },
          { title: 'Device Management', href: '/devices', active: location.pathname === '/devices' },
        ],
      },
      {
        title: 'Attendance',
        icon: CalendarCheck,
        items: [
          {
            title: 'Attendance Logs',
            href: '/attendance-logs',
            active: location.pathname === '/attendance-logs',
          },
        ],
      },
    ],
    footer: (
      <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
        <span className="group-data-[collapsible=icon]:hidden">v1.0.0</span>
      </div>
    ),
  }

  return (
    <div className="h-full">
      <AppShell
        navMode={navMode}
        logo={<Fingerprint className="size-4" />}
        title="ZKTeco ADMS"
        subtitle="Bridge System"
        homeHref="/users"
        linkComponent={RouterLink}
        breadcrumbs={[
          ...(!isUsersHome ? [{ label: 'Users', href: '/users' }] : []),
          { label: pageTitle },
        ]}
        headerEnd={
          <>
            <HeaderDeviceStatus />
            <Separator orientation="vertical" className="h-4" />
            <HeaderConnection userEmail={user?.email} onSignOut={signOut} />
          </>
        }
      >
        <Routes>
          <Route path="/" element={<Navigate to="/users" replace />} />
          <Route path="/dashboard" element={<Navigate to="/users" replace />} />
          <Route path="/users" element={<Users />} />
          <Route path="/attendance-logs" element={<AttendanceLogs />} />
          <Route path="/devices" element={<Devices />} />
        </Routes>
      </AppShell>
    </div>
  )
}

// HashRouter under Frappe (/adms is a single www page — hash routes need no
// server-side rewrite rules and survive deep-link refreshes); BrowserRouter
// for the standalone deployment.
const Router = isFrappeMode ? HashRouter : BrowserRouter

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        <AuthProvider>
          <Router>
            <AppContent />
          </Router>
        </AuthProvider>
        <Toaster />
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}

export default App

import { ThemeProvider } from 'next-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { BrowserRouter, Routes, Route, useLocation, Link } from 'react-router-dom'
import { AttendanceLogs } from './pages/AttendanceLogs'
import { Devices } from './pages/Devices'
import { Users } from './pages/Users'
import { Dashboard } from './pages/Dashboard'
import { LoginPage } from './pages/Login'
import { AuthProvider, useAuth } from '@/contexts/auth-context'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Loader2, LogOut } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/animate-ui/components/radix/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { HeaderConnection } from '@/components/header-connection'
import { HeaderDeviceStatus } from '@/components/header-device-status'
import { useRealtimeDevices } from '@/hooks/use-core-data'

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
  '/': 'Overview',
  '/attendance-logs': 'Attendance Logs',
  '/devices': 'Device Management',
  '/users': 'User Management',
}

function AppContent() {
  const location = useLocation()
  const pageTitle = routeTitles[location.pathname] || 'Dashboard'
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

  return (
    <div className="h-full">
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="flex flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <div className="flex items-center justify-between gap-2 px-4 w-full">
              <div className="flex items-center gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mr-2 data-[orientation=vertical]:h-4"
                />
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink asChild>
                        <Link to="/">Dashboard</Link>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    {location.pathname !== '/' && (
                      <>
                        <BreadcrumbSeparator className="hidden md:block" />
                        <BreadcrumbItem>
                          <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
                        </BreadcrumbItem>
                      </>
                    )}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              <div className="flex items-center gap-2">
                <HeaderDeviceStatus />
                <Separator orientation="vertical" className="h-4" />
                <HeaderConnection userEmail={user?.email} onSignOut={signOut} />
              </div>
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0 min-w-0 overflow-hidden">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/attendance-logs" element={<AttendanceLogs />} />
              <Route path="/devices" element={<Devices />} />
              <Route path="/users" element={<Users />} />
            </Routes>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        <AuthProvider>
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </AuthProvider>
        <Toaster />
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}

export default App

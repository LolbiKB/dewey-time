import { useDashboardStats } from '@/hooks/use-dashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  Users, 
  Monitor, 
  Clock,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { UserService } from '@/services/user-service'
import { cn } from '@/lib/utils'

export function Dashboard() {
  const { data: stats, isLoading, refetch, isFetching } = useDashboardStats()

  // Get sync health
  const { data: healthData } = useQuery({
    queryKey: ['sync-health'],
    queryFn: () => UserService.getSyncHealth(),
    refetchInterval: 30000,
  })

  const fmt = (v: number | undefined) => isLoading ? '...' : v ?? 0

  const pendingCommands = healthData?.data?.commands?.pending ?? 0
  const failedCommands = healthData?.data?.commands?.failed ?? 0
  const syncedUsers = healthData?.data?.users?.synced ?? 0
  const syncingUsers = healthData?.data?.users?.syncing ?? 0
  const failedUsers = healthData?.data?.users?.failed ?? 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-end">
        <button 
          onClick={() => refetch()} 
          disabled={isFetching}
          className="p-2 rounded-lg hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Link to="/users" className="hover:bg-secondary/50 rounded-lg transition-colors">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <Users className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Users</p>
                <p className="text-2xl font-bold">{fmt(stats?.totalUsers)}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/devices" className="hover:bg-secondary/50 rounded-lg transition-colors">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <Monitor className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Online</p>
                <p className="text-2xl font-bold">{fmt(stats?.onlineDevices)}/{fmt(stats?.totalDevices)}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <div className="hover:bg-secondary/50 rounded-lg transition-colors">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <RefreshCw className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Syncs</p>
                <p className="text-2xl font-bold">{fmt(stats?.syncsToday)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
        <Link to="/attendance-logs" className="hover:bg-secondary/50 rounded-lg transition-colors">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <Clock className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Attendance Today</p>
                <p className="text-2xl font-bold">{fmt(stats?.attendanceToday)}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Sync Health Section */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Pending Commands */}
        <Card className={cn(pendingCommands > 0 && "border-amber-300")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Commands</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {pendingCommands > 0 ? (
                <Clock className="h-5 w-5 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
              <span className="text-2xl font-bold">{pendingCommands}</span>
            </div>
          </CardContent>
        </Card>

        {/* Failed Commands */}
        <Card className={cn(failedCommands > 0 && "border-red-300")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed Commands</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {failedCommands > 0 ? (
                <AlertTriangle className="h-5 w-5 text-red-500" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
              <span className="text-2xl font-bold">{failedCommands}</span>
            </div>
          </CardContent>
        </Card>

        {/* User Sync Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">User Sync Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                {syncedUsers}
              </span>
              <span className="flex items-center gap-1">
                <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
                {syncingUsers}
              </span>
              {failedUsers > 0 && (
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  {failedUsers}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

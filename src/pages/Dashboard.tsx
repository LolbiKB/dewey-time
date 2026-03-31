import { useDashboardStats } from '@/hooks/use-dashboard'
import { Card, CardContent } from '@/components/ui/card'
import { 
  Users, 
  Monitor, 
  Clock,
  RefreshCw
} from 'lucide-react'
import { Link } from 'react-router-dom'

export function Dashboard() {
  const { data: stats, isLoading, refetch, isFetching } = useDashboardStats()

  const fmt = (v: number | undefined) => isLoading ? '...' : v ?? 0

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
    </div>
  )
}

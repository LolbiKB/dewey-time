import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type AttendanceLog } from '@/lib/supabase'
import { fetchFrappeEmployees, type EmployeeStatus } from '@/lib/frappe'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

async function loadEmployeeStatus() {
  // Fetch employees from Frappe HR
  const frappeEmployees = await fetchFrappeEmployees()

  // Fetch all attendance logs from Supabase
  const { data: logs } = await supabase
    .from('attendance_logs')
    .select('user_id, timestamp')
    .order('timestamp', { ascending: false })

  // Group logs by user_id
  const userLogs = new Map<string, { lastScan: string; count: number }>()
  logs?.forEach((log: { user_id: string; timestamp: string }) => {
    const existing = userLogs.get(log.user_id)
    if (!existing) {
      userLogs.set(log.user_id, { lastScan: log.timestamp, count: 1 })
    } else {
      existing.count++
    }
  })

  // Combine Frappe employees with attendance status
  const employeeStatus: EmployeeStatus[] = frappeEmployees.map(emp => {
    const admsData = userLogs.get(emp.employee_id)
    return {
      frappeId: emp.name,
      employeeId: emp.employee_id,
      employeeName: emp.employee_name,
      department: emp.department,
      status: emp.status,
      isRegistered: !!admsData,
      lastScan: admsData?.lastScan,
      totalScans: admsData?.count || 0
    }
  })

  return employeeStatus
}

export default function Dashboard() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'registered' | 'not-registered'>('all')

  const { data: employees = [], isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['employee-status'],
    queryFn: loadEmployeeStatus,
    refetchInterval: 1000 * 30, // Auto-refetch every 30 seconds
  })

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ['employee-status'] })
  }

  const filteredEmployees = employees.filter(emp => {
    if (filter === 'registered') return emp.isRegistered
    if (filter === 'not-registered') return !emp.isRegistered
    return true
  })

  const stats = {
    total: employees.length,
    registered: employees.filter(e => e.isRegistered).length,
    notRegistered: employees.filter(e => !e.isRegistered).length
  }

  function formatLastScan(timestamp?: string) {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)

    if (diffHours < 1) return 'Less than 1h ago'
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays === 1) return 'Yesterday'
    return `${diffDays} days ago`
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">ADMS Registration Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Monitor employee registration status across ZKTeco devices
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Total Employees</CardDescription>
              <CardTitle className="text-3xl">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Registered in ADMS</CardDescription>
              <CardTitle className="text-3xl text-green-600">{stats.registered}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Not Registered</CardDescription>
              <CardTitle className="text-3xl text-red-600">{stats.notRegistered}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Main Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Employee Status</CardTitle>
                <CardDescription className="mt-1">
                  Last refreshed: {new Date(dataUpdatedAt).toLocaleTimeString()}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={filter === 'all' ? 'default' : 'outline'}
                  onClick={() => setFilter('all')}
                  size="sm"
                >
                  All
                </Button>
                <Button
                  variant={filter === 'registered' ? 'default' : 'outline'}
                  onClick={() => setFilter('registered')}
                  size="sm"
                >
                  Registered
                </Button>
                <Button
                  variant={filter === 'not-registered' ? 'default' : 'outline'}
                  onClick={() => setFilter('not-registered')}
                  size="sm"
                >
                  Not Registered
                </Button>
                <Button onClick={handleRefresh} disabled={isLoading} size="sm">
                  {isLoading ? 'Refreshing...' : 'Refresh'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee Name</TableHead>
                  <TableHead>Badge ID</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>ADMS Status</TableHead>
                  <TableHead>Last Scan</TableHead>
                  <TableHead className="text-right">Total Scans</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {error ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-red-500">
                      Error loading employees: {error instanceof Error ? error.message : 'Unknown error'}
                    </TableCell>
                  </TableRow>
                ) : isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                      Loading employees...
                    </TableCell>
                  </TableRow>
                ) : filteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                      No employees found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees.map(emp => (
                    <TableRow key={emp.frappeId}>
                      <TableCell className="font-medium">{emp.employeeName}</TableCell>
                      <TableCell>{emp.employeeId}</TableCell>
                      <TableCell>{emp.department || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={emp.status === 'Active' ? 'default' : 'secondary'}>
                          {emp.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {emp.isRegistered ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                            ✓ Registered
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            ✗ Not Registered
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {formatLastScan(emp.lastScan)}
                      </TableCell>
                      <TableCell className="text-right">
                        {emp.totalScans > 0 ? emp.totalScans : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Footer Info */}
        <Card className="mt-6 bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <p className="text-sm text-blue-900">
              <strong>Note:</strong> Employee data is fetched from Frappe HR.
              Registration status is determined by checking if the employee has any attendance records in the ADMS system.
              To update Frappe HR integration, edit <code className="bg-blue-100 px-1 rounded">src/lib/frappe.ts</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

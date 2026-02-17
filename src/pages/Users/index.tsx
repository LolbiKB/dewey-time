import { useState, useMemo } from 'react'
import { useUsers } from '@/hooks/use-users'
import { UserDataTable } from '@/components/users/data-table'
import { columns } from './columns'
import { SyncStatusDialog } from '@/components/users/sync-status-dialog'
import { RegisterDialog } from '@/components/users/register-dialog'
import { ChangeStatusDialog } from '@/components/users/change-status-dialog'
import { EnrollBiometricDialog } from '@/components/users/enroll-biometric-dialog'
import type { UserEntry } from '@/services/user-service'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export function Users() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'compromised' | 'archived' | 'all'>('all')
  const [syncStatusUser, setSyncStatusUser] = useState<UserEntry | null>(null)
  const [registerEmployee, setRegisterEmployee] = useState<UserEntry | null>(null)
  const [changeStatusUser, setChangeStatusUser] = useState<UserEntry | null>(null)
  const [enrollBiometricUser, setEnrollBiometricUser] = useState<UserEntry | null>(null)
  const { data, isLoading, isFetching, refetch } = useUsers({
    page,
    limit: 20,
    search: search || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
  })

  // Count compromised users in current data
  const compromisedCount = useMemo(() => {
    return data?.data?.filter(user => user.status === 'compromised').length || 0
  }, [data])

  const handleViewSyncStatus = (user: UserEntry) => {
    if (!user.id) return
    setSyncStatusUser(user)
  }

  const handleEnrollBiometric = (user: UserEntry) => {
    if (!user.id) return
    setEnrollBiometricUser(user)
  }

  const handleRegister = (user: UserEntry) => {
    setRegisterEmployee(user)
  }

  const handleChangeStatus = (user: UserEntry) => {
    if (!user.id) return
    setChangeStatusUser(user)
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Compromised Users Alert */}
      {statusFilter !== 'compromised' && compromisedCount > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Compromised Users Detected</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {compromisedCount} user{compromisedCount !== 1 ? 's' : ''} marked as compromised on this page.
              These are employees deleted from Frappe HR but still in ADMS.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-4 bg-background hover:bg-background/80"
              onClick={() => setStatusFilter('compromised')}
            >
              View Compromised
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <UserDataTable
        columns={columns}
        data={data?.data || []}
        loading={isLoading}
        isFetching={isFetching}
        filters={{
          page,
          limit: 20,
          search: search || undefined,
          status: statusFilter === 'all' ? undefined : statusFilter,
        }}
        onFiltersChange={(newFilters) => {
          if (newFilters.page !== undefined) setPage(newFilters.page)
          if (newFilters.search !== undefined) setSearch(newFilters.search)
        }}
        onRefresh={() => refetch()}
        toolbarActions={
          <div className="flex items-center gap-2">
            <Label htmlFor="status-filter" className="text-sm font-medium">
              Status:
            </Label>
            <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
              <SelectTrigger id="status-filter" className="w-35 h-9">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="compromised">Compromised</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        meta={{
          onViewSyncStatus: handleViewSyncStatus,
          onEnrollBiometric: handleEnrollBiometric,
          onRegister: handleRegister,
          onChangeStatus: handleChangeStatus,
        }}
      />

      <SyncStatusDialog
        user={syncStatusUser}
        open={!!syncStatusUser}
        onOpenChange={(open) => !open && setSyncStatusUser(null)}
      />

      <RegisterDialog
        employee={registerEmployee}
        open={!!registerEmployee}
        onOpenChange={(open) => !open && setRegisterEmployee(null)}
      />

      <ChangeStatusDialog
        user={changeStatusUser}
        open={!!changeStatusUser}
        onOpenChange={(open) => !open && setChangeStatusUser(null)}
      />

      <EnrollBiometricDialog
        user={enrollBiometricUser}
        open={!!enrollBiometricUser}
        onOpenChange={(open) => !open && setEnrollBiometricUser(null)}
      />
    </div>
  )
}

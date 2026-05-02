import { useState, useMemo } from 'react'
import { useUsers } from '@/hooks/use-users'
import { UserDataTable } from '@/components/users/data-table'
import { columns } from './columns'
import { SyncStatusDialog } from '@/components/users/sync-status-dialog'
import { RegisterDialog } from '@/components/users/register-dialog'
import { ChangeStatusDialog } from '@/components/users/change-status-dialog'
import { EnrollBiometricDialog } from '@/components/users/enroll-biometric-dialog'
import { BiometricViewDialog } from '@/components/users/biometric-view-dialog'
import { PhotoRefreshDialog } from '@/components/users/photo-refresh-dialog'
import type { UserFilters, UserEntry } from '@/services/user-service'
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
import { AlertCircle, AlertTriangle } from 'lucide-react'

export function Users() {
  const [filters, setFilters] = useState<UserFilters>({
    page: 1,
    limit: 20,
  })
  const [syncStatusUser, setSyncStatusUser] = useState<UserEntry | null>(null)
  const [registerEmployee, setRegisterEmployee] = useState<UserEntry | null>(null)
  const [changeStatusUser, setChangeStatusUser] = useState<UserEntry | null>(null)
  const [enrollBiometricUser, setEnrollBiometricUser] = useState<UserEntry | null>(null)
  const [viewBiometricUser, setViewBiometricUser] = useState<UserEntry | null>(null)
  const [refreshPhotoUser, setRefreshPhotoUser] = useState<UserEntry | null>(null)
  
  const { data, isLoading, isFetching, refetch } = useUsers(filters)

  const compromisedCount = useMemo(() => {
    return data?.data?.filter(user => user.status === 'compromised').length || 0
  }, [data])

  const flaggedCount = useMemo(() => {
    return data?.data?.filter(user => user.attendance_flagged_at).length || 0
  }, [data])

  // Check if current filter is showing compromised users
  const showingCompromised = filters.status === 'compromised'

  const handleViewSyncStatus = (user: UserEntry) => {
    if (!user.id) return
    setSyncStatusUser(user)
  }

  const handleEnrollBiometric = (user: UserEntry) => {
    if (!user.id) return
    setEnrollBiometricUser(user)
  }

  const handleViewBiometric = (user: UserEntry) => {
    if (!user.id) return
    setViewBiometricUser(user)
  }

  const handleRegister = (user: UserEntry) => {
    setRegisterEmployee(user)
  }

  const handleChangeStatus = (user: UserEntry) => {
    if (!user.id) return
    setChangeStatusUser(user)
  }

  const handleRefreshPhoto = (user: UserEntry) => {
    if (!user.id) return
    setRefreshPhotoUser(user)
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {!showingCompromised && compromisedCount > 0 && (
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
              onClick={() => setFilters(prev => ({ ...prev, status: 'compromised', page: 1 }))}
            >
              View Compromised
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {flaggedCount > 0 && (
        <Alert variant="destructive" className="border-orange-500 bg-orange-50">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <AlertTitle className="text-orange-800">Suspicious Attendance Detected</AlertTitle>
          <AlertDescription className="flex items-center justify-between text-orange-700">
            <span>
              {flaggedCount} user{flaggedCount !== 1 ? 's' : ''} with suspicious attendance patterns detected.
              These users clocked in from multiple devices at the same time.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <UserDataTable
        columns={columns}
        data={data?.data || []}
        tableMeta={data?.meta}
        loading={isLoading}
        isFetching={isFetching}
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={() => refetch()}
        toolbarActions={
          <div className="flex items-center gap-2">
            <Label htmlFor="registration-filter" className="text-sm font-medium">
              Registration:
            </Label>
            <Select 
              value={filters.registration_status || 'all'} 
              onValueChange={(value) => setFilters(prev => ({ 
                ...prev, 
                registration_status: value === 'all' ? undefined : value as 'registered' | 'unregistered' | 'inactive',
                page: 1 
              }))}
            >
              <SelectTrigger id="registration-filter" className="w-40 h-9">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                <SelectItem value="registered">Registered</SelectItem>
                <SelectItem value="unregistered">Unregistered</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        meta={{
          onViewSyncStatus: handleViewSyncStatus,
          onEnrollBiometric: handleEnrollBiometric,
          onViewBiometric: handleViewBiometric,
          onRegister: handleRegister,
          onChangeStatus: handleChangeStatus,
          onRefreshPhoto: handleRefreshPhoto,
        }}
      />

      <SyncStatusDialog
        user={syncStatusUser}
        userId={syncStatusUser?.id || ''}
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

      <BiometricViewDialog
        userId={viewBiometricUser?.id || null}
        userName={viewBiometricUser?.name || null}
        open={!!viewBiometricUser}
        onOpenChange={(open) => !open && setViewBiometricUser(null)}
      />

      <PhotoRefreshDialog
        user={refreshPhotoUser}
        open={!!refreshPhotoUser}
        onOpenChange={(open) => !open && setRefreshPhotoUser(null)}
        onSuccess={() => refetch()}
      />
    </div>
  )
}
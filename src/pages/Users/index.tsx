import { useState, useMemo } from 'react'
import { useUsers } from '@/hooks/use-users'
import { useQueryClient } from '@tanstack/react-query'
import { UserDataTable } from '@/components/users/data-table'
import { columns } from './columns'
import { SyncStatusDialog } from '@/components/users/sync-status-dialog'
import { RegisterDialog } from '@/components/users/register-dialog'
import { ChangeStatusDialog } from '@/components/users/change-status-dialog'
import { EnrollBiometricDialog } from '@/components/users/enroll-biometric-dialog'
import { PhotoService } from '@/services/photo-service'
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
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

export function Users() {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<UserFilters>({
    page: 1,
    limit: 20,
  })
  const [syncStatusUser, setSyncStatusUser] = useState<UserEntry | null>(null)
  const [registerEmployee, setRegisterEmployee] = useState<UserEntry | null>(null)
  const [changeStatusUser, setChangeStatusUser] = useState<UserEntry | null>(null)
  const [enrollBiometricUser, setEnrollBiometricUser] = useState<UserEntry | null>(null)
  
  const { data, isLoading, isFetching, refetch } = useUsers(filters)

  const compromisedCount = useMemo(() => {
    return data?.data?.filter(user => user.status === 'compromised').length || 0
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

  const handleRegister = (user: UserEntry) => {
    setRegisterEmployee(user)
  }

  const handleChangeStatus = (user: UserEntry) => {
    if (!user.id) return
    setChangeStatusUser(user)
  }

  const handleRefreshPhoto = async (user: UserEntry) => {
    if (!user.id || !user.frappe_employee_id) return
    
    try {
      toast.info(`Processing photo for ${user.name}...`)
      
      const result = await PhotoService.processAndStorePhoto(user.id, user.photo_url || '')
      
      if (result.success) {
        toast.success(`Photo for ${user.name} processed successfully`, {
          description: `Size: ${result.processedImage?.size ? (result.processedImage.size / 1024).toFixed(1) : '?'}KB, ${result.processedImage?.width}x${result.processedImage?.height}px`,
        })
        queryClient.invalidateQueries({ queryKey: ['user-photo', user.id] })
      } else {
        toast.error(result.message || 'Failed to process photo', {
          description: result.errors?.join(', '),
        })
      }
    } catch (error) {
      console.error('Photo refresh error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to refresh photo')
    }
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
    </div>
  )
}
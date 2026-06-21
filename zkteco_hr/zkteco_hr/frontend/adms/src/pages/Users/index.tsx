"use client"

import { useState, useMemo } from 'react'
import { useUsersList } from '@/hooks'
import { UserDataTable } from '@/components/users/data-table'
import { columns } from './columns'
import { RegisterDialog } from '@/components/users/register-dialog'
import { UserDetailModal } from '@/components/users/user-detail-modal'
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
import { Page } from '@lolbikb/dewey-ui'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { signalAlert, signalText } from '@/lib/signal'

export function Users() {
  const [filters, setFilters] = useState<UserFilters>({
    page: 1,
    limit: 20,
  })
  const [selectedUser, setSelectedUser] = useState<UserEntry | null>(null)
  const [registerEmployee, setRegisterEmployee] = useState<UserEntry | null>(null)

  const { data, isLoading, isFetching, refetch } = useUsersList({
    page: filters.page,
    limit: filters.limit,
    search: filters.search,
    status: filters.status,
    registration_status: filters.registration_status,
  })

  const compromisedCount = useMemo(() => {
    return data?.data?.filter(user => user.status === 'compromised').length || 0
  }, [data])

  const flaggedCount = useMemo(() => {
    return data?.data?.filter(user => user.attendance_flagged_at).length || 0
  }, [data])

  const showingCompromised = filters.status === 'compromised'

  const handleUserClick = (user: UserEntry) => {
    setSelectedUser(user)
  }

  const handleRegister = (user: UserEntry) => {
    setRegisterEmployee(user)
  }

  return (
    <Page>
      {!showingCompromised && compromisedCount > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Compromised Users Detected</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {compromisedCount} user{compromisedCount !== 1 ? 's' : ''} marked as compromised.
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
        <Alert className={signalAlert.attention}>
          <AlertTriangle className={`h-4 w-4 ${signalText.attention}`} />
          <AlertTitle>Suspicious Attendance</AlertTitle>
          <AlertDescription>
            {flaggedCount} user{flaggedCount !== 1 ? 's' : ''} with suspicious attendance patterns
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
          <div className="flex items-center gap-3">
            <Label htmlFor="registration-filter" className="text-sm font-medium">
              Status:
            </Label>
            <Select
              value={filters.registration_status || 'all'}
              onValueChange={(value) => setFilters(prev => ({
                ...prev,
                registration_status: value === 'all' ? undefined : value as 'registered' | 'unregistered' | 'inactive',
                page: 1
              }))}
            >
              <SelectTrigger id="registration-filter" className="w-36 h-9">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="registered">Registered</SelectItem>
                <SelectItem value="unregistered">Unregistered</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        meta={{
          onUserClick: handleUserClick,
          onRegister: handleRegister,
        }}
      />

      <UserDetailModal
        user={selectedUser}
        open={!!selectedUser}
        onOpenChange={(open) => !open && setSelectedUser(null)}
        onRefreshList={refetch}
      />

      <RegisterDialog
        employee={registerEmployee}
        open={!!registerEmployee}
        onOpenChange={(open) => !open && setRegisterEmployee(null)}
      />
    </Page>
  )
}
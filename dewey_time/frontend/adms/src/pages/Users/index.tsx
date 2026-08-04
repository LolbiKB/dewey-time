"use client"

import { useState, useMemo } from 'react'
import { useUsersList } from '@/hooks'
import { UserDataTable } from '@/components/users/data-table'
import { columns } from './columns'
import { RegisterDialog } from '@/components/users/register-dialog'
import { UserDetailModal } from '@/components/users/user-detail-modal'
import { FlaggedCountIndicator } from '@/components/users/flagged-count-indicator'
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
import { QueryErrorCard } from '@/components/shared/query-error-card'
import { Page } from '@lolbikb/dewey-ui'
import { AlertCircle } from 'lucide-react'

export function Users() {
  const [filters, setFilters] = useState<UserFilters>({
    page: 1,
    limit: 20,
  })
  const [selectedUser, setSelectedUser] = useState<UserEntry | null>(null)
  const [registerEmployee, setRegisterEmployee] = useState<UserEntry | null>(null)

  // isFetching (not isLoading) is what a manual refetch flips once rows exist.
  const { data, isLoading, isFetching, isError, error, refetch } = useUsersList({
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

  // Nothing to show and the query failed: an outage must not read as an empty
  // database, so name the reason instead of falling through to "No users found".
  if (isError && !data) {
    return (
      <QueryErrorCard
        title="Error loading users"
        error={error}
        onRetry={() => void refetch()}
      />
    )
  }

  return (
    <Page>
      {/* The direct-read path disagreed with the server, so the server's list is
          shown instead. Say so: the failure this replaces was every registered
          employee silently appearing as "Compromised User Detected" because the
          signed-in account's Frappe permissions returned no employees. */}
      {data?.degraded && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Showing the server&apos;s employee list</AlertTitle>
          <AlertDescription>
            {data.degraded.message}
            <span className="ml-1 opacity-70">
              ({data.degraded.diffCount} difference
              {data.degraded.diffCount === 1 ? '' : 's'} detected)
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Rows are still on screen (kept from the last good fetch) but the latest
          fetch failed — say so rather than showing silently stale data. */}
      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not refresh users</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              Showing the last loaded list.{' '}
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-4 bg-background hover:bg-background/80"
              onClick={() => void refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

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

      {/* The attendance flag is deliberately NOT in this alert stack — see
          FlaggedCountIndicator. It rides the toolbar instead. */}

      <UserDataTable
        columns={columns}
        data={data?.data || []}
        tableMeta={data?.meta}
        loading={isLoading}
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={() => refetch()}
        refreshing={isFetching}
        toolbarActions={
          <div className="flex items-center gap-3">
            <FlaggedCountIndicator count={flaggedCount} />
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
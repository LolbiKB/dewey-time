import { useState, useMemo } from 'react'
import { startOfDay, endOfDay, parseISO, formatISO } from 'date-fns'
import { MainLayout } from '../../components/layout/main-layout'
import { AuditLogDataTable } from '../../components/audit-logs/data-table'
import { createAuditLogColumns } from '../../components/audit-logs/columns'
import { useAuditLogManagement } from '../../hooks/use-audit-logs'
import { useAuth } from '../../hooks/use-auth'
import { DataLoadErrorState } from '../../components/ui/error-state-variants'
import type { AuditLogFilters, AuditLogEntry } from '../../services/audit-log-service'

export function AuditLogs() {
  // Get auth context to extract user permissions
  const { user } = useAuth()

  // State for managing filters and pagination
  const [filters, setFilters] = useState<AuditLogFilters>({
    page: 1,
    limit: 20,
    sort: 'timestamp',
    order: 'desc'
  })

  // Extract available categories from user permissions
  const availableCategories = useMemo(() => {
    if (!user?.permissions) return []

    // Extract unique categories from permissions (before the colon)
    const categories = user.permissions
      .map(permission => permission.split(':')[0])
      .filter((category, index, array) => array.indexOf(category) === index) // Remove duplicates
      .map(category => category.toUpperCase()) // Convert to uppercase to match audit log format
      .filter(category => category !== 'AUDIT_LOGS') // Exclude audit_logs from the filter options

    return categories
  }, [user?.permissions])  // Use TanStack Query for data management
  const {
    data,
    meta,
    isLoading,
    isError,
    error,
    refetchAuditLogs,
    isFetching
  } = useAuditLogManagement(filters)

  // Handle filter changes
  const handleFiltersChange = (newFilters: AuditLogFilters) => {
    setFilters(newFilters)
  }

  const handleViewDetails = (log: AuditLogEntry) => {
    // TODO: Implement details modal
    console.log('View details for log:', log)
  }

  const handleViewUser = (userId: string) => {
    // TODO: Navigate to user details or open user modal
    console.log('View user:', userId)
  }

  // Create columns with callbacks
  const columns = createAuditLogColumns({
    onViewDetails: handleViewDetails,
    onViewUser: handleViewUser,
    onFilterByCategory: (category: string | undefined) => {
      setFilters(prev => ({ ...prev, category, page: 1 }))
    },
    onFilterByAction: (action: string | undefined) => {
      setFilters(prev => ({ ...prev, action, page: 1 }))
    },
    onFilterByDate: (date: Date | undefined) => {
      if (date) {
        // Filter by selected date (from start of day to end of day) using date-fns
        const dateFromStart = startOfDay(date)
        const dateToEnd = endOfDay(date)

        setFilters(prev => ({
          ...prev,
          dateFrom: formatISO(dateFromStart),
          dateTo: formatISO(dateToEnd),
          page: 1
        }))
      } else {
        // Clear date filter
        setFilters(prev => {
          const { dateFrom, dateTo, ...rest } = prev
          return { ...rest, page: 1 }
        })
      }
    },
    currentActionFilter: filters.action,
    currentCategoryFilter: filters.category,
    currentDateFilter: filters.dateFrom ? parseISO(filters.dateFrom) : undefined,
    availableCategories: availableCategories,
  })

  if (isError) {
    return (
      <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "Audit Logs" }] }}>
        <DataLoadErrorState
          dataType="audit logs"
          onRetry={() => refetchAuditLogs()}
          customMessage={error instanceof Error ? error.message : undefined}
        />
      </MainLayout>
    )
  }

  return (
    <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "Audit Logs" }] }}>
      <div className="h-full">
        <AuditLogDataTable
          columns={columns}
          data={data || []}
          meta={meta}
          loading={isLoading}
          isFetching={isFetching}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onRefresh={refetchAuditLogs}
        />
      </div>
    </MainLayout>
  )
}

export default AuditLogs
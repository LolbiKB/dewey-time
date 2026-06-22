import { useState } from 'react'
import { MainLayout } from '../../components/layout/main-layout'
import { DataTable } from '../../components/employee-management/data-table'
import { useEmployeeManagement, useEmployeeRoles, useEmployeeTermTypes } from '../../hooks/use-employees'
import type { EmployeeFilters } from '../../services/employee-service'



export function EmployeeManagement() {
  const [filters, setFilters] = useState<EmployeeFilters>({
    page: 1,
    limit: 20,
    sort: 'created_at',
    order: 'desc',
  })

  // Use the employee management hook
  const {
    data: employees,
    meta,
    isLoading,
    isError,
    error,
    refetchEmployees
  } = useEmployeeManagement(filters)

  // Fetch filter options
  const { data: roles, isLoading: isLoadingRoles } = useEmployeeRoles()
  const { data: termTypes, isLoading: isLoadingTermTypes } = useEmployeeTermTypes()

  // DataTable handles all column actions internally

  const handleFiltersChange = (newFilters: EmployeeFilters) => {
    setFilters(newFilters)
  }

  const handleRefresh = () => {
    refetchEmployees()
  }

  const handleCreateEmployee = () => {
    // TODO: Open create employee modal
  }

  // Handle error state
  if (isError) {
    console.error('Employee fetch error:', error)
  }

  return (
    <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "Employee Management" }] }}>
      <div className="h-full">
        <DataTable
          data={employees}
          meta={meta}
          loading={isLoading}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onRefresh={handleRefresh}
          onCreateEmployee={handleCreateEmployee}
          roles={roles}
          termTypes={termTypes}
          isLoadingRoles={isLoadingRoles}
          isLoadingTermTypes={isLoadingTermTypes}
        />
      </div>
    </MainLayout>
  )
}

export default EmployeeManagement

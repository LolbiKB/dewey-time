import { useState } from 'react'
import { format } from 'date-fns'

import { MainLayout } from '../../components/layout/main-layout'
import { DataTable } from '../../components/user-management/data-table'
import { createColumns } from '../../components/user-management/columns'
import { useUserManagement, useDeleteUser } from '../../hooks/use-users'
import { DataLoadErrorState } from '../../components/ui/error-state-variants'
import { UserModal } from '../../components/user-management/modals/user-modal'
import { DeleteUserModal } from '../../components/user-management/modals/delete-user-modal'
import { useUserModal } from '../../hooks/use-user-modal'
import type { UserFilters } from '../../services/user-service'
import type { User } from '../../components/user-management/columns'

export function UserManagement() {
  // State for managing filters and pagination
  const [filters, setFilters] = useState<UserFilters>({
    page: 1,
    limit: 20,
    sort: 'createdAt',
    order: 'desc'
  })

  // State for column-level filters
  const [genderFilter, setGenderFilter] = useState<string>("")
  const [dateOfBirthFilter, setDateOfBirthFilter] = useState<Date | undefined>(undefined)
  const [createdAtFilter, setCreatedAtFilter] = useState<Date | undefined>(undefined)

  // Handle filter changes and sync with backend filters
  const handleGenderFilter = (gender: string | undefined) => {
    setGenderFilter(gender || "")
    setFilters(prev => ({
      ...prev,
      gender: (gender && ['male', 'female', 'other'].includes(gender) ? gender as 'male' | 'female' | 'other' : undefined),
      page: 1 // Reset to first page when filtering
    }))
  }

  const handleDateOfBirthFilter = (date: Date | undefined) => {
    setDateOfBirthFilter(date)
    const dateStr = date ? format(date, 'yyyy-MM-dd') : undefined
    setFilters(prev => ({
      ...prev,
      dateOfBirthAfter: dateStr,
      dateOfBirthBefore: dateStr,
      page: 1 // Reset to first page when filtering
    }))
  }

  const handleCreatedAtFilter = (date: Date | undefined) => {
    setCreatedAtFilter(date)
    const dateStr = date ? format(date, 'yyyy-MM-dd') : undefined
    setFilters(prev => ({
      ...prev,
      createdAfter: dateStr,
      createdBefore: dateStr,
      page: 1 // Reset to first page when filtering
    }))
  }

  // Modal state management
  const userModal = useUserModal()
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<User | null>(null)

  // Use TanStack Query for data management
  const {
    data,
    meta,
    isLoading,
    isError,
    error,
    refetchUsers
  } = useUserManagement(filters)

  // Delete user mutation
  const deleteUserMutation = useDeleteUser()

  // Handle filter changes
  const handleFiltersChange = (newFilters: UserFilters) => {
    setFilters(newFilters)
  }

  // Create columns with callbacks
  const columns = createColumns({
    onEditUser: (userId) => userModal.openEdit(userId),
    onDeleteUser: (user) => {
      setUserToDelete(user)
      setDeleteModalOpen(true)
    },
    // Filter callbacks
    onFilterByGender: handleGenderFilter,
    onFilterByDateOfBirth: handleDateOfBirthFilter,
    onFilterByCreatedAt: handleCreatedAtFilter,
    // Current filter values
    currentGenderFilter: genderFilter,
    currentDateOfBirthFilter: dateOfBirthFilter,
    currentCreatedAtFilter: createdAtFilter,
  })

  if (isError) {
    return (
      <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "User Management" }] }}>
        <DataLoadErrorState
          dataType="users"
          onRetry={() => refetchUsers()}
          customMessage={error instanceof Error ? error.message : undefined}
        />
      </MainLayout>
    )
  }

  return (
    <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "User Management" }] }}>
      <div className="h-full">
        <DataTable
          columns={columns}
          data={data || []}
          meta={meta}
          loading={isLoading}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onRefresh={refetchUsers}
          onCreateUser={() => userModal.openCreate()}
        />
      </div>

      {/* User Modal for Create/Edit */}
      <UserModal
        mode={userModal.mode}
        userId={userModal.selectedUserId}
        isOpen={userModal.isOpen}
        onOpenChange={() => userModal.close()}
        onSuccess={() => {
          userModal.close()
          refetchUsers()
        }}
      />

      {/* Delete User Modal */}
      <DeleteUserModal
        user={userToDelete}
        isOpen={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        onConfirmDelete={async (userId: string) => {
          await deleteUserMutation.mutateAsync(userId)
          setDeleteModalOpen(false)
          setUserToDelete(null)
        }}
        isDeleting={deleteUserMutation.isPending}
      />
    </MainLayout>
  )
}

export default UserManagement

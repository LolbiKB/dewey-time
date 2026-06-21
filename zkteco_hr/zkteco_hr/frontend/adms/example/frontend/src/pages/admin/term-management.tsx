import { useState } from 'react'
import { DataTable } from '@/components/term-management/data-table'
import { createColumns, type Term } from '@/components/term-management/columns'
import { useTerms, useDeleteTerm, useSetActiveTerm } from '@/hooks/use-terms'
import type { TermFilters } from '@/services/term-service'
import { MainLayout } from '@/components/layout/main-layout'
import { DataLoadErrorState } from '@/components/ui/error-state-variants'
import { TermModal } from '@/components/term-management/modals/term-modal'
import { SetActiveTermModal } from '@/components/term-management/modals/set-active-term-modal'
import { DeleteConfirmationModal } from '@/components/ui/delete-confirmation-modal'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

export function TermManagement() {
  const [filters, setFilters] = useState<TermFilters>({
    page: 1,
    limit: 20,
    sort: 'start_date',
    order: 'desc',
  })

  // Use the term management hooks
  const {
    data: terms,
    isLoading,
    isFetching,
    isError,
    error,
    refetch: refetchTerms
  } = useTerms(filters)

  // Mutations
  const deleteTerm = useDeleteTerm()
  const setActiveTerm = useSetActiveTerm()

  // State for modals (will be implemented later)
  const [selectedTerm, setSelectedTerm] = useState<Term | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isSetActiveModalOpen, setIsSetActiveModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Create columns with callbacks
  const columns = createColumns({
    onSetActiveTerm: (term: Term) => {
      setSelectedTerm(term)
      setIsSetActiveModalOpen(true)
    },
    onEditTerm: (term: Term) => {
      setSelectedTerm(term)
      setIsEditModalOpen(true)
    },
    onDeleteTerm: (term: Term) => {
      setSelectedTerm(term)
      setIsDeleteModalOpen(true)
    },
  })

  const handleFiltersChange = (newFilters: TermFilters) => {
    setFilters(newFilters)
  }

  const handleRefresh = () => {
    refetchTerms()
  }

  const handleCreateTerm = () => {
    setIsCreateModalOpen(true)
  }

  const handleModalSuccess = () => {
    // Refresh the term list after successful create/update
    refetchTerms()
  }

  const handleSetActiveConfirm = async (termId: number) => {
    try {
      await setActiveTerm.mutateAsync(termId)
      toast.success('Active term set successfully', {
        description: `${selectedTerm?.name} is now the active term`
      })
      setIsSetActiveModalOpen(false)
      setSelectedTerm(null)
      refetchTerms()
    } catch (error) {
      toast.error('Failed to set active term', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
    }
  }

  const handleDeleteTerm = async (termId: string) => {
    await deleteTerm.mutateAsync(parseInt(termId, 10))
    // Refresh the term list after successful delete
    refetchTerms()
  }

  // Handle error state
  if (isError) {
    console.error('Term fetch error:', error)
    return (
      <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "Terms" }] }}>
        <DataLoadErrorState
          dataType="terms"
          customMessage="There was an error loading the term data. Please try again."
          onRetry={handleRefresh}
        />
      </MainLayout>
    )
  }

  return (
    <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "Terms" }] }}>
      <DataTable
        columns={columns}
        data={terms?.data || []}
        meta={terms?.meta}
        loading={isLoading || isFetching}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onRefresh={handleRefresh}
        onCreateTerm={handleCreateTerm}
      />

      {/* Create Term Modal */}
      <TermModal
        mode="create"
        isOpen={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={handleModalSuccess}
      />

      {/* Edit Term Modal */}
      <TermModal
        mode="edit"
        termId={selectedTerm?.id}
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        onSuccess={handleModalSuccess}
      />

      {/* Set Active Term Modal */}
      <SetActiveTermModal
        term={selectedTerm}
        isOpen={isSetActiveModalOpen}
        onOpenChange={setIsSetActiveModalOpen}
        onConfirmSetActive={handleSetActiveConfirm}
        isProcessing={setActiveTerm.isPending}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        item={selectedTerm ? {
          id: selectedTerm.id.toString(),
          displayName: selectedTerm.name,
          subtitle: (() => {
            const formatDate = (dateString: string | null) => {
              if (!dateString) return null
              try {
                return format(parseISO(dateString), "MMM dd, yyyy")
              } catch {
                return null
              }
            }
            const startDate = formatDate(selectedTerm.start_date)
            const endDate = formatDate(selectedTerm.end_date)
            return startDate && endDate ? `${startDate} - ${endDate}` : 'No dates set'
          })(),
          showAvatar: false
        } : null}
        isOpen={isDeleteModalOpen}
        onOpenChange={(open) => {
          setIsDeleteModalOpen(open)
          if (!open) {
            setSelectedTerm(null)
          }
        }}
        onConfirmDelete={handleDeleteTerm}
        isDeleting={deleteTerm.isPending}
        config={{
          title: 'Delete Term',
          description: 'This action will permanently remove the term record.',
          entityName: 'term',
          successMessage: 'Term deleted successfully',
          errorMessage: 'Failed to delete term',
          confirmationText: selectedTerm?.name || '',
          confirmationInstruction: 'Type the term name to confirm deletion.'
        }}
      />
    </MainLayout>
  )
}


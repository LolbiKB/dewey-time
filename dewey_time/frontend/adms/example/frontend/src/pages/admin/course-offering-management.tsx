import { useState, useEffect, useRef } from "react"
import { MainLayout } from "@/components/layout/main-layout"
import { DataTable } from "@/components/course-offering-management/data-table"
import { createColumns, type CourseOffering } from "@/components/course-offering-management/columns"
import { CourseOfferingModal } from "@/components/course-offering-management/modals/course-offering-modal"
import { DeleteConfirmationModal } from "@/components/ui/delete-confirmation-modal"
import { useCourseOfferings, useCourseOfferingTerms, useDeleteCourseOffering } from "@/hooks/use-course-offerings"
import type { CourseOfferingFilters } from "@/services/course-offering-service"

export function CourseOfferingManagement() {
  const [filters, setFilters] = useState<CourseOfferingFilters>({
    page: 1,
    limit: 20,
  })

  // Track if term filter has been set initially
  const hasSetInitialTerm = useRef(false)

  // Fetch terms to get the active term
  const { data: terms } = useCourseOfferingTerms()

  // Set active term as default filter on initial load only
  useEffect(() => {
    if (terms && terms.length > 0 && !hasSetInitialTerm.current) {
      const activeTerm = terms.find(term => term.is_active)
      if (activeTerm) {
        setFilters(prev => ({
          ...prev,
          term_id: activeTerm.id
        }))
      }
      hasSetInitialTerm.current = true
    }
  }, [terms])

  // Use the course offering management hooks
  const {
    data: offerings,
    isLoading,
    isFetching,
    refetch: refetchOfferings,
  } = useCourseOfferings(filters)

  const deleteCourseOffering = useDeleteCourseOffering()

  // State for modals
  const [selectedOffering, setSelectedOffering] = useState<CourseOffering | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Create columns with callbacks
  const columns = createColumns({
    onEdit: (offering: CourseOffering) => {
      setSelectedOffering(offering)
      setIsEditModalOpen(true)
    },
    onDelete: (offering: CourseOffering) => {
      setSelectedOffering(offering)
      setIsDeleteModalOpen(true)
    },
    onFilterByTerm: (termId: string) => {
      setFilters({
        ...filters,
        term_id: termId ? Number(termId) : undefined,
        page: 1, // Reset to first page when filtering
      })
    },
    onFilterByInstructor: (instructorId: string) => {
      setFilters({
        ...filters,
        instructor_id: instructorId ? Number(instructorId) : undefined,
        page: 1, // Reset to first page when filtering
      })
    },
    onFilterByStatus: (status: string) => {
      setFilters({
        ...filters,
        status: status || undefined,
        page: 1, // Reset to first page when filtering
      })
    },
    currentTermFilter: filters.term_id?.toString(),
    currentInstructorFilter: filters.instructor_id?.toString(),
    currentStatusFilter: filters.status,
  })

  const handleFiltersChange = (newFilters: CourseOfferingFilters) => {
    setFilters(newFilters)
  }

  const handleRefresh = () => {
    refetchOfferings()
  }

  const handleCreateOffering = () => {
    setIsCreateModalOpen(true)
  }

  const handleModalSuccess = () => {
    refetchOfferings()
  }

  const handleDeleteOffering = async (offeringId: string) => {
    await deleteCourseOffering.mutateAsync(parseInt(offeringId, 10))
    // Refresh the offering list after successful delete
    refetchOfferings()
  }

  return (
    <MainLayout
      breadcrumb={{
        items: [{ label: "Academic" }, { label: "Course Offerings" }],
      }}
    >
      <DataTable
        columns={columns}
        data={offerings?.data || []}
        meta={offerings?.meta}
        loading={isLoading || isFetching}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onRefresh={handleRefresh}
        onCreateOffering={handleCreateOffering}
      />

      {/* Create Modal */}
      <CourseOfferingModal
        isOpen={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={handleModalSuccess}
        mode="create"
      />

      {/* Edit Modal */}
      <CourseOfferingModal
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        onSuccess={handleModalSuccess}
        courseOffering={selectedOffering}
        mode="edit"
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        item={selectedOffering ? {
          id: selectedOffering.id.toString(),
          displayName: `${selectedOffering.courses?.course_code} ${selectedOffering.section}`,
          subtitle: `${selectedOffering.courses?.course_name || 'Unknown Course'} - ${selectedOffering.term_types?.name || 'Unknown Term'}`,
          showAvatar: false
        } : null}
        isOpen={isDeleteModalOpen}
        onOpenChange={(open) => {
          setIsDeleteModalOpen(open)
          if (!open) {
            setSelectedOffering(null)
          }
        }}
        onConfirmDelete={handleDeleteOffering}
        isDeleting={deleteCourseOffering.isPending}
        config={{
          title: 'Delete Course Offering',
          description: 'This action will permanently remove the course offering and all its schedules.',
          entityName: 'course offering',
          successMessage: 'Course offering deleted successfully',
          errorMessage: 'Failed to delete course offering',
          confirmationText: selectedOffering ? `${selectedOffering.courses?.course_code} ${selectedOffering.section}` : '',
          confirmationInstruction: 'Type the course code and section to confirm deletion.'
        }}
      />
    </MainLayout>
  )
}

export default CourseOfferingManagement

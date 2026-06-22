import { useState } from "react"
import { MainLayout } from "@/components/layout/main-layout"
import { DataTable } from "@/components/course-management/data-table"
import { createCourseColumns, type Course } from "@/components/course-management/columns"
import { CourseModal } from "@/components/course-management/modals/course-modal"
import { useCourses, useDeleteCourse } from "@/hooks/use-courses"
import type { CourseFilters } from "@/services/course-service"
import { DeleteConfirmationModal } from "@/components/ui/delete-confirmation-modal"
import { DataLoadErrorState } from "@/components/ui/error-state-variants"

export function CourseManagement() {
  const [filters, setFilters] = useState<CourseFilters>({
    page: 1,
    limit: 20,
    sort: "course_code",
    order: "asc",
  })

  // Use the course management hooks
  const {
    data: courses,
    isLoading,
    isFetching,
    isError,
    error,
    refetch: refetchCourses,
  } = useCourses(filters)

  // Delete course mutation
  const deleteCourse = useDeleteCourse()

  // State for modals
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Create columns with callbacks
  const columns = createCourseColumns({
    onEditCourse: (course: Course) => {
      setSelectedCourse(course)
      setIsEditModalOpen(true)
    },
    onDeleteCourse: (course: Course) => {
      setSelectedCourse(course)
      setIsDeleteModalOpen(true)
    },
    onFilterByDepartment: (departmentId: string) => {
      setFilters({
        ...filters,
        department_id: departmentId ? Number(departmentId) : undefined,
        page: 1,
      })
    },
    onFilterByStatus: (status: string) => {
      setFilters({
        ...filters,
        status: status || undefined,
        page: 1,
      })
    },
    currentDepartmentFilter: filters.department_id?.toString(),
    currentStatusFilter: filters.status,
  })

  const handleFiltersChange = (newFilters: CourseFilters) => {
    setFilters(newFilters)
  }

  const handleRefresh = () => {
    refetchCourses()
  }

  const handleCreateCourse = () => {
    setIsCreateModalOpen(true)
  }

  const handleModalSuccess = () => {
    // Refresh the course list after successful create/update
    refetchCourses()
  }

  const handleDeleteCourse = async (courseId: string) => {
    await deleteCourse.mutateAsync(parseInt(courseId))
    // Refresh the course list after successful delete
    refetchCourses()
  }

  // Handle error state
  if (isError) {
    console.error("Course fetch error:", error)
    return (
      <MainLayout breadcrumb={{ items: [{ label: "Academic" }, { label: "Courses" }] }}>
        <DataLoadErrorState
          dataType="courses"
          customMessage="There was an error loading the course data. Please try again."
          onRetry={handleRefresh}
        />
      </MainLayout>
    )
  }

  return (
    <MainLayout breadcrumb={{ items: [{ label: "Academic" }, { label: "Courses" }] }}>
      <DataTable
        columns={columns}
        data={courses?.data || []}
        meta={courses?.meta}
        loading={isLoading || isFetching}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onRefresh={handleRefresh}
        onCreateCourse={handleCreateCourse}
      />

      {/* Course Modals */}
      <CourseModal
        mode="create"
        isOpen={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={handleModalSuccess}
      />

      <CourseModal
        mode="edit"
        isOpen={isEditModalOpen}
        onOpenChange={(open) => {
          setIsEditModalOpen(open)
          if (!open) {
            setSelectedCourse(null)
          }
        }}
        course={selectedCourse}
        onSuccess={handleModalSuccess}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        item={selectedCourse ? {
          id: selectedCourse.id.toString(),
          displayName: `${selectedCourse.course_code} - ${selectedCourse.course_name}`,
          subtitle: `${selectedCourse.credits} credits`,
          showAvatar: false
        } : null}
        isOpen={isDeleteModalOpen}
        onOpenChange={(open) => {
          setIsDeleteModalOpen(open)
          if (!open) {
            setSelectedCourse(null)
          }
        }}
        onConfirmDelete={handleDeleteCourse}
        isDeleting={deleteCourse.isPending}
        config={{
          title: "Delete Course",
          description: "This action will permanently remove the course record.",
          entityName: "course",
          successMessage: "Course {name} deleted successfully",
          errorMessage: "Failed to delete course",
          confirmationText: selectedCourse?.course_code || "",
          confirmationInstruction: "Type the course code to confirm deletion."
        }}
      />
    </MainLayout>
  )
}

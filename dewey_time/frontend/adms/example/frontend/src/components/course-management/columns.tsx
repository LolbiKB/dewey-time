import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Edit, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { z } from "zod"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"
import { BadgeCell, DescriptionCell, SelectFilterHeader, IDCell } from "@/components/ui/table-components"
import { useCourseDepartmentTypes } from "@/hooks/use-courses"

// Callback functions for column actions and filters
interface ColumnCallbacks {
  onEditCourse?: (course: Course) => void
  onDeleteCourse?: (course: Course) => void
  onFilterByDepartment?: (departmentId: string) => void
  onFilterByStatus?: (status: string) => void
  currentDepartmentFilter?: string
  currentStatusFilter?: string
}

// Course type based on database schema
export const courseSchema = z.object({
  id: z.number(),
  course_code: z.string(),
  course_name: z.string(),
  description: z.string().nullable(),
  credits: z.number(),
  department_type_id: z.number().nullable(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  // Relations
  department_types: z
    .object({
      id: z.number(),
      name: z.string(),
      description: z.string().nullable(),
    })
    .nullable(),
})

export type Course = z.infer<typeof courseSchema>

// Function to create columns with optional callbacks
export function createCourseColumns(
  callbacks?: ColumnCallbacks
): ColumnDef<Course>[] {
  return [
    {
      accessorKey: "course_code",
      header: () => {
        return <span className="font-medium">Course Code</span>
      },
      cell: ({ row }) => {
        const code = row.getValue("course_code") as string
        return <IDCell id={code} />
      },
    },
    {
      accessorKey: "course_name",
      header: () => {
        return <span className="font-medium">Course Name</span>
      },
      cell: ({ row }) => {
        const name = row.getValue("course_name") as string
        return name
      },
    },
    {
      accessorKey: "description",
      header: () => {
        return <span className="font-medium">Description</span>
      },
      cell: ({ row }) => {
        const description = row.getValue("description") as string | null
        return <DescriptionCell description={description} />
      },
    },
    {
      accessorKey: "credits",
      header: () => {
        return <span className="font-medium">Credits</span>
      },
      cell: ({ row }) => {
        const credits = row.getValue("credits") as number
        return (
          <div className="text-center">
            <BadgeCell value={credits.toString()} variant="outline" />
          </div>
        )
      },
    },
    {
      id: "department",
      accessorKey: "department_types",
      header: () => {
        if (!callbacks?.onFilterByDepartment) {
          return <span className="font-medium">Department</span>
        }

        // Fetch department types for filter
        const { data: departmentTypes, isLoading } = useCourseDepartmentTypes()

        return (
          <SelectFilterHeader
            title="Departments"
            options={departmentTypes?.map(department => ({
              value: department.id.toString(),
              label: department.name
            })) || []}
            currentFilter={callbacks?.currentDepartmentFilter}
            onFilterChange={(value) => callbacks?.onFilterByDepartment?.(value)}
            onClearFilter={() => callbacks?.onFilterByDepartment?.("")}
            disabled={isLoading}
          />
        )
      },
      cell: ({ row }) => {
        const course = row.original
        const department = course.department_types

        if (!department) {
          return <span className="text-muted-foreground">—</span>
        }

        return department.name
      },
    },
    {
      accessorKey: "status",
      header: () => {
        if (!callbacks?.onFilterByStatus) {
          return <span className="font-medium">Status</span>
        }

        return (
          <SelectFilterHeader
            title="Status"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "archived", label: "Archived" },
            ]}
            currentFilter={callbacks?.currentStatusFilter}
            onFilterChange={(value) => callbacks?.onFilterByStatus?.(value)}
            onClearFilter={() => callbacks?.onFilterByStatus?.("")}
          />
        )
      },
      cell: ({ row }) => {
        const status = row.getValue("status") as string
        const variant = status === "active" ? "default" : "secondary"

        return (
          <BadgeCell
            value={status.charAt(0).toUpperCase() + status.slice(1)}
            variant={variant}
            transform="none"
          />
        )
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const course = row.original
        const { hasPermission } = useAuth()

        // Check if user has any permissions for course actions
        const canUpdate = hasPermission(PERMISSIONS.COURSE_MANAGEMENT.UPDATE)
        const canDelete = hasPermission(PERMISSIONS.COURSE_MANAGEMENT.DELETE)
        const hasAnyActionPermission = canUpdate || canDelete

        // Don't render anything if user has no permissions
        if (!hasAnyActionPermission) {
          return null
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>

              {canUpdate && (
                <DropdownMenuItem
                  onClick={() => callbacks?.onEditCourse?.(course)}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}

              {canDelete && (
                <DropdownMenuItem
                  onClick={() => callbacks?.onDeleteCourse?.(course)}
                  variant="destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
}

// Default export for backward compatibility
export const courseColumns = createCourseColumns()

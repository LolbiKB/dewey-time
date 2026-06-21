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
import { BadgeCell, DescriptionCell, SelectFilterHeader } from "@/components/ui/table-components"
import { useProgramDegreeTypes, useProgramDepartmentTypes } from "@/hooks/use-programs"

// Callback functions for column actions and filters
interface ColumnCallbacks {
  onEditProgram?: (program: Program) => void
  onDeleteProgram?: (program: Program) => void
  onFilterByDegree?: (degreeId: string) => void
  onFilterByDepartment?: (departmentId: string) => void
  currentDegreeFilter?: string
  currentDepartmentFilter?: string
}

// Program type based on database schema
export const programSchema = z.object({
  id: z.number(),
  major: z.string(),
  description: z.string().nullable(),
  department_type_id: z.number().nullable(),
  degree_id: z.number().nullable(),
  // Relations
  degree_types: z
    .object({
      id: z.number(),
      name: z.string(),
      abbreviation: z.string().nullable(),
    })
    .nullable(),
  department_types: z
    .object({
      id: z.number(),
      name: z.string(),
      description: z.string().nullable(),
    })
    .nullable(),
})

export type Program = z.infer<typeof programSchema>

// Function to create columns with optional callbacks
export function createProgramColumns(
  callbacks?: ColumnCallbacks
): ColumnDef<Program>[] {
  return [
    {
      accessorKey: "major",
      header: () => {
        return <span className="font-medium">Major / Program Name</span>
      },
      cell: ({ row }) => {
        const major = row.getValue("major") as string
        return (major)
      },
    },
    {
      id: "degree",
      accessorKey: "degree_types",
      header: () => {
        if (!callbacks?.onFilterByDegree) {
          return <span className="font-medium">Degree</span>
        }

        // Fetch degree types for filter
        const { data: degreeTypes, isLoading } = useProgramDegreeTypes()

        return (
          <SelectFilterHeader
            title="Degrees"
            options={degreeTypes?.map(degree => ({
              value: degree.id.toString(),
              label: degree.name
            })) || []}
            currentFilter={callbacks?.currentDegreeFilter}
            onFilterChange={(value) => callbacks?.onFilterByDegree?.(value)}
            onClearFilter={() => callbacks?.onFilterByDegree?.("")}
            disabled={isLoading}
          />
        )
      },
      cell: ({ row }) => {
        const program = row.original
        const degree = program.degree_types

        if (!degree) {
          return <span className="text-muted-foreground">—</span>
        }

        return (
          <div className="flex items-center gap-2">
            {degree.abbreviation && (
              <BadgeCell value={degree.abbreviation} variant="outline" />
            )}
            {degree.name}
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
        const { data: departmentTypes, isLoading } = useProgramDepartmentTypes()

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
        const program = row.original
        const department = program.department_types

        if (!department) {
          return <span className="text-muted-foreground">—</span>
        }

        return (department.name)
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
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const program = row.original
        const { hasPermission } = useAuth()

        // Check if user has any permissions for program actions
        const canWrite = hasPermission(PERMISSIONS.PROGRAM_MANAGEMENT.WRITE)
        const canDelete = hasPermission(PERMISSIONS.PROGRAM_MANAGEMENT.DELETE)
        const hasAnyActionPermission = canWrite || canDelete

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

              {canWrite && (
                <DropdownMenuItem
                  onClick={() => callbacks?.onEditProgram?.(program)}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}

              {canDelete && (
                <DropdownMenuItem
                  onClick={() => callbacks?.onDeleteProgram?.(program)}
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
export const programColumns = createProgramColumns()

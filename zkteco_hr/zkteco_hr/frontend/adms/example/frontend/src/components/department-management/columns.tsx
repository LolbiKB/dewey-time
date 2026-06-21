import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, Edit, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { z } from "zod"
import { useAuth } from "../../hooks/use-auth"
import { PERMISSIONS } from "../../lib/permissions"
import { DescriptionCell } from "../ui/table-components"

// Callback functions for column actions
interface ColumnCallbacks {
  onEditDepartment?: (department: Department) => void
  onDeleteDepartment?: (department: Department) => void
}

export const departmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().optional(),
})

export type Department = z.infer<typeof departmentSchema>

// Function to create columns with optional callbacks
export function createColumns(callbacks?: ColumnCallbacks): ColumnDef<Department>[] {
  return [
    {
      accessorKey: "name",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-auto p-0 font-medium"
          >
            Name
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => {
        const department = row.original
        return (
          department.name
        )
      },
    },
    {
      accessorKey: "description",
      header: () => {
        return (
          <span className="font-medium">Description</span>
        )
      },
      cell: ({ row }) => {
        const description = row.getValue("description") as string | undefined
        return <DescriptionCell maxWidth="50vw" description={description} />
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const department = row.original
        const { hasPermission } = useAuth()

        // Check if user has any permissions for department actions
        const canEdit = hasPermission(PERMISSIONS.DEPARTMENT_MANAGEMENT.WRITE)
        const canDelete = hasPermission(PERMISSIONS.DEPARTMENT_MANAGEMENT.DELETE)
        const hasAnyActionPermission = canEdit || canDelete

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

              {/* Edit Department - Requires WRITE access */}
              {callbacks?.onEditDepartment && canEdit && (
                <DropdownMenuItem onClick={() => callbacks.onEditDepartment?.(department)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}

              {/* Delete Department - Requires DELETE access */}
              {callbacks?.onDeleteDepartment && canDelete && (
                <DropdownMenuItem
                  onClick={() => callbacks.onDeleteDepartment?.(department)}
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
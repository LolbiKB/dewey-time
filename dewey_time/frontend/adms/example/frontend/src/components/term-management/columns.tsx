import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Edit, Trash2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { format, parseISO } from "date-fns"
import { DescriptionCell } from "@/components/ui/table-components"

// Callback functions for column actions
interface ColumnCallbacks {
  onSetActiveTerm?: (term: Term) => void
  onEditTerm?: (term: Term) => void
  onDeleteTerm?: (term: Term) => void
}

export const termSchema = z.object({
  id: z.number(),
  name: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  description: z.string().nullable(),
  is_current: z.boolean(),
})

export type Term = z.infer<typeof termSchema>

// Helper function to format dates without timezone issues
function formatDate(dateString: string | null): string {
  if (!dateString) return "—"
  try {
    // Parse the ISO string and format it as a local date to avoid timezone shifts
    const date = parseISO(dateString)
    // Format using date-fns to ensure consistent display (e.g., "Aug 30, 2021")
    return format(date, "MMM dd, yyyy")
  } catch {
    return "—"
  }
}

// Function to create columns with optional callbacks
export function createColumns(callbacks?: ColumnCallbacks): ColumnDef<Term>[] {
  return [
    {
      accessorKey: "name",
      header: () => {
        return <span className="font-medium">Name</span>
      },
      cell: ({ row }) => {
        const term = row.original
        return (
          <div className="flex items-center gap-2">
            {term.name}
            {term.is_current && (
              <Badge variant="secondary" className="px-2 py-0.5 text-xs text-success">
                Current
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "start_date",
      header: () => {
        return (
          <span className="font-medium flex items-center">
            Start Date
          </span>
        )
      },
      cell: ({ row }) => {
        const startDate = row.getValue("start_date") as string | null
        return formatDate(startDate)
      },
    },
    {
      accessorKey: "end_date",
      header: () => {
        return (
          <span className="font-medium flex items-center">
            End Date
          </span>
        )
      },
      cell: ({ row }) => {
        const endDate = row.getValue("end_date") as string | null
        return formatDate(endDate)
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
        const description = row.getValue("description") as string | null
        return <DescriptionCell description={description} />
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const term = row.original
        const { hasPermission } = useAuth()

        const canEdit = hasPermission(PERMISSIONS.TERM_MANAGEMENT.WRITE)
        const canDelete = hasPermission(PERMISSIONS.TERM_MANAGEMENT.DELETE)
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

              {/* Set Active Term - Requires WRITE access */}
              {callbacks?.onSetActiveTerm && canEdit && (
                <DropdownMenuItem onClick={() => callbacks.onSetActiveTerm?.(term)}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Set Active
                </DropdownMenuItem>
              )}

              {/* Edit Term - Requires WRITE access */}
              {callbacks?.onEditTerm && canEdit && (
                <DropdownMenuItem onClick={() => callbacks.onEditTerm?.(term)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}

              {/* Delete Term - Requires DELETE access */}
              {callbacks?.onDeleteTerm && canDelete && (
                <DropdownMenuItem
                  onClick={() => callbacks.onDeleteTerm?.(term)}
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

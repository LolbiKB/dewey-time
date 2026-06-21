import { useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { FileText, MapPin } from "lucide-react"
import { format, parseISO } from "date-fns"
import type { AuditLogEntry } from "../../services/audit-log-service"
import { ChangesModal } from "./modals/changes-modal"
import {
  SelectFilterHeader,
  DateFilterHeader,
  UserCell,
  TwoLineTextCell,
  BadgeCell
} from "../ui/table-components"

/**
 * Props for creating audit log columns with callbacks
 */
interface CreateAuditLogColumnsProps {
  onViewDetails?: (log: AuditLogEntry) => void
  onViewUser?: (userId: string) => void
  onFilterByCategory?: (category: string | undefined) => void
  onFilterByAction?: (action: string | undefined) => void
  onFilterByDate?: (date: Date | undefined) => void
  currentActionFilter?: string
  currentCategoryFilter?: string
  currentDateFilter?: Date
  availableActions?: string[]
  availableCategories?: string[]
}



/**
 * Create audit log table columns
 */
export function createAuditLogColumns({
  onFilterByCategory,
  onFilterByAction,
  onFilterByDate,
  currentActionFilter,
  currentCategoryFilter,
  currentDateFilter,
  availableActions = ['CREATED', 'UPDATED', 'DELETED', 'VIEWED'],
  availableCategories = ['USER_ADMINISTRATION', 'SYSTEM', 'SECURITY']
}: CreateAuditLogColumnsProps = {}): ColumnDef<AuditLogEntry>[] {
  return [
    {
      id: "timestamp",
      accessorKey: "timestamp",
      header: () => {
        if (!onFilterByDate) {
          return <span className="font-medium">Timestamp</span>
        }

        return (
          <DateFilterHeader
            title="Timestamp"
            currentFilter={currentDateFilter}
            onFilterChange={onFilterByDate}
          />
        )
      },
      cell: ({ row }) => {
        const timestamp = parseISO(row.getValue("timestamp"))
        return (
          <TwoLineTextCell
            mainText={format(timestamp, "MMM d, yyyy")}
            secondaryText={format(timestamp, "h:mm a")}
          />
        )
      },
    },
    {
      id: "user",
      accessorKey: "users",
      header: "User",
      cell: ({ row }) => {
        const user = row.original.users

        if (!user) {
          return <span className="text-muted-foreground">Unknown User</span>
        }

        return <UserCell user={user} />
      },
    },
    {
      id: "action",
      accessorKey: "action",
      header: () => {
        if (!onFilterByAction) {
          return <span className="font-medium">Action</span>
        }

        return (
          <SelectFilterHeader
            title="Action"
            options={availableActions.map(action => ({ value: action, label: action }))}
            currentFilter={currentActionFilter}
            onFilterChange={(value) => value ? onFilterByAction(value) : onFilterByAction(undefined)}
            onClearFilter={() => onFilterByAction(undefined)}
          />
        )
      },
      cell: ({ row }) => {
        const action = row.getValue("action") as string
        return <BadgeCell value={action} transform="uppercase" />
      },
    },
    {
      id: "category",
      accessorKey: "resource_type",
      header: () => {
        if (!onFilterByCategory) {
          return <span className="font-medium">Category</span>
        }

        return (
          <SelectFilterHeader
            title="Category"
            options={availableCategories.map(category => ({
              value: category,
              label: category.replace(/_/g, ' ')
            }))}
            currentFilter={currentCategoryFilter}
            onFilterChange={(value) => value ? onFilterByCategory(value) : onFilterByCategory(undefined)}
            onClearFilter={() => onFilterByCategory(undefined)}
          />
        )
      },
      cell: ({ row }) => {
        const category = row.original.resource_type as string
        return <BadgeCell value={category || 'Unknown'} transform="replace-underscore" />
      },
    },
    {
      id: "resource",
      accessorKey: "resource_id",
      header: "Resource",
      cell: ({ row }) => {
        const resourceId = row.original.resource_id as string
        if (!resourceId) return <span className="text-muted-foreground">—</span>

        return (
          <div className="font-mono">ID: {resourceId}</div>
        )
      },
    },
    {
      id: "changes",
      header: "Changes",
      cell: ({ row }) => {
        const { old_values, new_values } = row.original
        const [showChangesModal, setShowChangesModal] = useState(false)

        // Parse JSON strings to objects
        let oldValues: Record<string, any> | null = null
        let newValues: Record<string, any> | null = null

        try {
          if (old_values) oldValues = JSON.parse(old_values)
          if (new_values) newValues = JSON.parse(new_values)
        } catch (error) {
          console.error('Error parsing audit log values:', error)
        }

        const hasOldValues = oldValues && Object.keys(oldValues).length > 0
        const hasNewValues = newValues && Object.keys(newValues).length > 0

        if (!hasOldValues && !hasNewValues) {
          return <span className="text-muted-foreground">—</span>
        }

        // Get all unique field names from both old and new values
        const allFields = new Set([
          ...(oldValues ? Object.keys(oldValues) : []),
          ...(newValues ? Object.keys(newValues) : [])
        ])

        // Count only fields that actually changed
        const changeCount = Array.from(allFields).filter(field => {
          const oldValue = oldValues?.[field]
          const newValue = newValues?.[field]

          // Field was added
          if (oldValue === undefined || oldValue === null) return true
          // Field was removed  
          if (newValue === undefined || newValue === null) return true
          // Field was modified
          if (oldValue !== newValue) return true

          return false // Field unchanged
        }).length

        return (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowChangesModal(true)}
              className="cursor-pointer hover:underline"
            >
              <FileText className="h-4 w-4" />
              <span className="text-sm">{changeCount} field{changeCount !== 1 ? 's' : ''}</span>
            </Button>

            <ChangesModal
              isOpen={showChangesModal}
              onClose={() => setShowChangesModal(false)}
              auditLog={row.original}
            />
          </>
        )
      },
    },
    {
      id: "location",
      header: "Location",
      cell: ({ row }) => {
        const { ip_address } = row.original

        if (!ip_address) return <span className="text-muted-foreground">—</span>

        return (
          <div className="flex items-center space-x-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-mono">{ip_address}</span>
          </div>
        )
      },
    }
  ]
}
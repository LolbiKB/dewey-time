import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MoreHorizontal, Fingerprint, ScanFace, UserPlus, AlertTriangle } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SyncStatusSummary } from '@/components/users/sync-status-summary'
import { UserCell } from '@/components/ui/table-components'
import type { UserEntry } from '@/services/user-service'

interface UserColumnMeta {
  onUserClick?: (user: UserEntry) => void
  onRegister?: (user: UserEntry) => void
}

export const columns: ColumnDef<UserEntry>[] = [
  {
    id: 'user',
    header: 'User',
    cell: ({ row }) => {
      const user = row.original
      return (
        <UserCell
          photoUrl={user.photo_url}
          hasCachedPhoto={!!user.photo_storage_path}
          userId={user.id || undefined}
          frappeEmployeeId={user.frappe_employee_id}
          name={user.name || 'Unknown'}
          secondaryText={user.frappe_employee_id}
          avatarSize="sm"
        />
      )
    },
  },
  {
    accessorKey: 'pin',
    header: 'PIN',
    cell: ({ row }) => {
      const pin = row.original.pin
      return (
        <div className="font-mono font-medium">
          {pin || <span className="text-xs italic text-muted-foreground">-</span>}
        </div>
      )
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const user = row.original

      if (!user.is_registered) {
        return <Badge variant="outline" className="text-xs">Unregistered</Badge>
      }

      const status = user.status as 'active' | 'inactive' | 'compromised' | 'archived' | null | undefined

      if (!status) return <span className="text-xs text-muted-foreground">-</span>

      const statusConfig = {
        active: { label: 'Active', className: 'text-green-700 dark:text-green-400' },
        inactive: { label: 'Inactive', className: 'text-gray-500 dark:text-gray-400' },
        compromised: { label: 'Compromised', className: 'text-red-700 dark:text-red-400' },
        archived: { label: 'Archived', className: 'text-slate-500 dark:text-slate-400' },
      }

      const config = statusConfig[status]
      return (
        <Badge variant="secondary" className={config.className}>
          {config.label}
        </Badge>
      )
    },
  },
  {
    id: 'attendance_flag',
    header: '',
    cell: ({ row }) => {
      const user = row.original
      const isFlagged = user.attendance_flagged_at

      if (!isFlagged) return null

      return (
        <Badge variant="secondary" className="gap-1 text-red-700" title="Suspicious attendance detected">
          <AlertTriangle className="h-3 w-3" />
        </Badge>
      )
    },
  },
  {
    id: 'biometrics',
    header: 'Bio',
    cell: ({ row }) => {
      const fingerprintCount = row.original.fingerprint_count || 0
      const faceCount = row.original.face_count || 0

      return (
        <div className="flex items-center gap-1">
          {fingerprintCount > 0 && (
            <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <Fingerprint className="h-3 w-3" />
              <span>{fingerprintCount}</span>
            </div>
          )}
          {faceCount > 0 && (
            <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <ScanFace className="h-3 w-3" />
              <span>{faceCount}</span>
            </div>
          )}
          {fingerprintCount === 0 && faceCount === 0 && (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </div>
      )
    },
  },
  {
    id: 'sync_status',
    header: 'Sync',
    cell: ({ row }) => {
      const user = row.original
      const isRegistered = user.is_registered

      if (!isRegistered || !user.id) {
        return <span className="text-xs text-muted-foreground">-</span>
      }

      return <SyncStatusSummary userId={user.id} />
    },
  },
  {
    accessorKey: 'privilege',
    header: 'Level',
    cell: ({ row }) => {
      const privilege = row.original.privilege
      if (privilege === null || privilege === undefined) return <span className="text-muted-foreground text-sm">-</span>

      const labels: Record<number, string> = {
        0: 'User',
        1: 'Enroller',
        2: 'Admin',
        3: 'Super',
      }
      return (
        <Badge variant="secondary" className="text-xs">
          {labels[privilege] || privilege}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'created_at',
    header: 'Created',
    cell: ({ row }) => {
      const createdAt = row.original.created_at
      if (!createdAt) return <span className="text-muted-foreground text-sm">-</span>

      const date = new Date(createdAt)
      return (
        <div className="text-sm text-muted-foreground">
          {date.toLocaleDateString()}
        </div>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row, table }) => {
      const user = row.original
      const meta = table.options.meta as UserColumnMeta
      const isRegistered = user.is_registered

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            {user.pin && (
              <>
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation()
                  navigator.clipboard.writeText(user.pin!)
                }}>
                  Copy PIN
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isRegistered ? (
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation()
                meta?.onUserClick?.(user)
              }}>
                View Details
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation()
                meta?.onRegister?.(user)
              }}>
                <UserPlus className="mr-2 h-4 w-4" />
                Register
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]
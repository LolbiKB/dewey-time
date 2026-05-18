import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MoreHorizontal, Fingerprint, ScanFace, RefreshCw, CircleDot, Image, AlertTriangle } from 'lucide-react'
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
          userId={user.id}
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
      const pin = row.getValue('pin') as string | null
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
      
      // Unregistered users don't have ADMS status
      if (!user.is_registered) {
        return <span className="text-xs text-muted-foreground">-</span>
      }
      
      const status = user.status as 'active' | 'inactive' | 'compromised' | 'archived' | null | undefined

      if (!status) return <span className="text-xs text-muted-foreground">-</span>

      const statusConfig = {
        active: { label: 'Active', className: 'bg-green-100 text-green-800 hover:bg-green-100' },
        inactive: { label: 'Inactive', className: 'bg-gray-100 text-gray-800 hover:bg-gray-100' },
        compromised: { label: 'Compromised', className: 'bg-red-100 text-red-800 hover:bg-red-100' },
        archived: { label: 'Archived', className: 'bg-slate-100 text-slate-800 hover:bg-slate-100' },
      }

      const config = statusConfig[status]
      return (
        <Badge className={config.className}>
          {config.label}
        </Badge>
      )
    },
  },
  {
    id: 'attendance_flag',
    header: 'Attendance',
    cell: ({ row }) => {
      const user = row.original
      const isFlagged = user.attendance_flagged_at

      if (!isFlagged) {
        return <span className="text-xs text-muted-foreground">-</span>
      }

      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Flagged
        </Badge>
      )
    },
  },
  {
    id: 'biometrics',
    header: 'Biometrics',
    cell: ({ row, table }) => {
      const user = row.original
      const meta = table.options.meta as any
      const fingerprintCount = row.original.fingerprint_count || 0
      const faceCount = row.original.face_count || 0
      const hasBiometrics = fingerprintCount > 0 || faceCount > 0

      return (
        <Button
          variant="ghost"
          size="sm"
          className={`h-auto p-1 gap-1 hover:bg-accent [&>svg]:h-3 [&>svg]:w-3 ${hasBiometrics ? 'cursor-pointer' : 'cursor-default'}`}
          onClick={(e) => {
            e.stopPropagation()
            if (hasBiometrics) {
              meta?.onViewBiometric?.(user)
            }
          }}
          disabled={!hasBiometrics}
        >
          <Badge variant={fingerprintCount > 0 ? 'default' : 'outline'} className="gap-1 text-[10px] h-5">
            <Fingerprint className="h-2 w-2" />
            {fingerprintCount}
          </Badge>
          <Badge variant={faceCount > 0 ? 'default' : 'outline'} className="gap-1 text-[10px] h-5">
            <ScanFace className="h-2 w-2" />
            {faceCount}
          </Badge>
        </Button>
      )
    },
  },
  {
    id: 'sync_status',
    header: 'Sync',
    cell: ({ row }) => {
      const user = row.original
      const isRegistered = user.is_registered

      // Only show sync status for registered users
      if (!isRegistered || !user.id) {
        return <span className="text-xs text-muted-foreground italic">-</span>
      }

      return <SyncStatusSummary userId={user.id} />
    },
  },
  {
    accessorKey: 'privilege',
    header: 'Privilege',
    cell: ({ row }) => {
      const privilege = row.getValue('privilege') as number | null
      if (privilege === null || privilege === undefined) return <span className="text-muted-foreground text-sm">-</span>

      const labels: Record<number, string> = {
        0: 'User',
        1: 'Enroller',
        2: 'Admin',
        3: 'Super Admin',
      }
      return (
        <Badge variant="secondary">
          {labels[privilege] || `Level ${privilege}`}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'created_at',
    header: 'Created',
    cell: ({ row }) => {
      const createdAt = row.getValue('created_at') as string | null
      if (!createdAt || createdAt === undefined) return <span className="text-muted-foreground text-sm">-</span>

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
      const meta = table.options.meta as any
      const isRegistered = user.is_registered

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
            {user.pin && (
              <>
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(user.pin!)}>
                  Copy PIN
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isRegistered ? (
              <>
                <DropdownMenuItem onClick={() => meta?.onViewSyncStatus?.(user)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  View Sync Status
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => meta?.onViewBiometric?.(user)}>
                  <Fingerprint className="mr-2 h-4 w-4" />
                  View Biometrics
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => meta?.onEnrollBiometric?.(user)}>
                  <ScanFace className="mr-2 h-4 w-4" />
                  Enroll Biometric
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => meta?.onRefreshPhoto?.(user)}>
                  <Image className="mr-2 h-4 w-4" />
                  Refresh Photo Cache
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => meta?.onChangeStatus?.(user)}>
                  <CircleDot className="mr-2 h-4 w-4" />
                  Change Status
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={() => meta?.onRegister?.(user)}>
                Register in Bridge
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]

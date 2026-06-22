import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, Edit, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { parse, format, differenceInYears, parseISO } from "date-fns"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { z } from "zod"
import {
  SelectFilterHeader,
  DateFilterHeader,
  UserCell,
  TwoLineTextCell,
} from "../ui/table-components"
import { useAuth } from "../../hooks/use-auth"
import { PERMISSIONS } from "../../lib/permissions"

// Callback functions for column actions
interface ColumnCallbacks {
  onEditUser?: (userId: string) => void
  onViewDetails?: (user: User) => void
  onManageRoles?: (user: User) => void
  onDeleteUser?: (user: User) => void
  onFilterByGender?: (gender: string | undefined) => void
  onFilterByDateOfBirth?: (date: Date | undefined) => void
  onFilterByCreatedAt?: (date: Date | undefined) => void
  currentGenderFilter?: string
  currentDateOfBirthFilter?: Date
  currentCreatedAtFilter?: Date
}

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  khmerFirstName: z.string().optional(),
  khmerLastName: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  avatarUrl: z.string().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(), // date
  address: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  authId: z.string().optional(), // for linking to auth system
})

export type User = z.infer<typeof userSchema>

// Function to create columns with optional callbacks
export function createColumns(callbacks?: ColumnCallbacks): ColumnDef<User>[] {
  return [
    {
      accessorKey: "user",
      header: "User",
      cell: ({ row }) => {
        const user = row.original
        return <UserCell user={user} />
      },
    },
    {
      accessorKey: "gender",
      header: () => {
        if (!callbacks?.onFilterByGender) {
          return <span className="font-medium">Gender</span>
        }

        return (
          <SelectFilterHeader
            title="Gender"
            options={[
              { value: "male", label: "male" },
              { value: "female", label: "female" },
              { value: "other", label: "other" }
            ]}
            currentFilter={callbacks?.currentGenderFilter}
            onFilterChange={(value) => callbacks?.onFilterByGender?.(value)}
            onClearFilter={() => callbacks?.onFilterByGender?.(undefined)}
          />
        )
      },
      cell: ({ row }) => {
        const gender = row.getValue("gender") as string | undefined
        if (!gender) return <span className="text-muted-foreground">—</span>
        return (gender)
      },
    },
    {
      accessorKey: "dateOfBirth",
      header: () => {
        if (!callbacks?.onFilterByDateOfBirth) {
          return <span className="font-medium">Date of Birth</span>
        }

        return (
          <DateFilterHeader
            title="Date of Birth"
            currentFilter={callbacks?.currentDateOfBirthFilter}
            onFilterChange={callbacks?.onFilterByDateOfBirth}
            maxDate={new Date()} // Can't be born in the future
          />
        )
      },
      cell: ({ row }) => {
        const dateOfBirth = row.getValue("dateOfBirth") as string | undefined
        if (!dateOfBirth) return <span className="text-muted-foreground">—</span>

        // Parse date safely using date-fns (no timezone issues)
        const date = parse(dateOfBirth, 'yyyy-MM-dd', new Date())
        const age = differenceInYears(new Date(), date)

        return (
          <TwoLineTextCell
            mainText={format(date, 'MMM d, yyyy')}
            secondaryText={`Age ${age}`}
          />
        )
      },
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => {
        const phone = row.getValue("phone") as string | undefined
        return phone || <span className="text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: "address",
      header: "Address",
      cell: ({ row }) => {
        const address = row.getValue("address") as string | undefined
        if (!address) return <span className="text-muted-foreground">—</span>

        // Split address into parts (street, city/area)
        const parts = address.split(',').map(part => part.trim())

        return (
          <div className="max-w-[250px] text-sm leading-relaxed">
            {parts.length > 1 ? (
              <>
                <div>{parts[0]}</div>
                <div className="text-muted-foreground">{parts.slice(1).join(', ')}</div>
              </>
            ) : (
              <div>{address}</div>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => {
        if (!callbacks?.onFilterByCreatedAt) {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Created
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        }

        return (
          <DateFilterHeader
            title="Created"
            currentFilter={callbacks?.currentCreatedAtFilter}
            onFilterChange={callbacks?.onFilterByCreatedAt}
            maxDate={new Date()} // Can't be created in the future
          />
        )
      },
      cell: ({ row }) => {
        const timestamp = row.getValue("createdAt") as string
        const date = parseISO(timestamp)
        return (
          <TwoLineTextCell
            mainText={format(date, 'MMM d, yyyy')}
            secondaryText={format(date, 'h:mm a')}
          />
        )
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const user = row.original
        const { hasPermission } = useAuth()

        // Check if user has any permissions for user actions
        const canWrite = hasPermission(PERMISSIONS.USER_ADMINISTRATION.WRITE)
        const canDelete = hasPermission(PERMISSIONS.USER_ADMINISTRATION.DELETE)
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

              {/* {canRead && (
                <DropdownMenuItem
                  onClick={() => navigator.clipboard.writeText(user.id)}
                >
                  <Clipboard className="mr-2 h-4 w-4" />
                  Copy ID
                </DropdownMenuItem>
              )} */}

              {/* Edit User - Requires WRITE access */}
              {canWrite && (
                <DropdownMenuItem
                  onClick={() => callbacks?.onEditUser?.(user.id)}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}

              {/* Delete User - Requires DELETE access */}
              {canDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => callbacks?.onDeleteUser?.(user)}
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
export const columns = createColumns()
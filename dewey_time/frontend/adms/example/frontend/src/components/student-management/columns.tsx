import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Trash2, GraduationCap, BookIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { format, parseISO, formatISO } from "date-fns"
import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SelectFilterHeader,
  DateFilterHeader,
  UserCell,
  TwoLineTextCell,
  BadgeCell,
  IDCell
} from "../ui/table-components"
import { ProgramHistoryModal } from "./modals/program-history-modal"
import { useStudentPrograms } from "@/hooks/use-students"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"

// Callback functions for column actions and filters
interface ColumnCallbacks {
  onDeleteStudent?: (student: Student) => void
  onManagePrograms?: (student: Student) => void
  onFilterByStatus?: (status: string) => void
  onFilterByAdmissionTerm?: (term: string) => void
  onFilterByCreatedDate?: (date: string) => void // ISO date string or empty string
  onUpdateFilters?: (updates: { program_id?: number | undefined }) => void
  currentStatusFilter?: string
  currentAdmissionTermFilter?: string
  currentCreatedDateFilter?: string // ISO date string for the selected date
  currentProgramFilter?: string
}

// Student type based on database schema
export interface Student {
  id: number
  student_id: string
  user_id: string
  admission_term_id?: number
  created_at: string
  updated_at: string

  // Related user data
  users: {
    id: string
    email: string
    first_name: string
    last_name: string
    khmer_first_name?: string
    khmer_last_name?: string
    phone?: string
    avatar_url?: string
    date_of_birth?: string
    gender?: 'male' | 'female' | 'other'
    address?: string
  }

  // Student program history
  student_program_history: Array<{
    id: number
    program_id: number
    start_date: string
    end_date?: string
    status: 'active' | 'inactive' | 'completed'
    programs: {
      id: number
      major: string
      description?: string
      degree_id: number
      department_type_id?: number
      degrees: {
        id: number
        name: string
        abbreviation?: string
      }
      department_types?: {
        id: number
        name: string
        description?: string
      } | null
    }
  }>

  // Admission term info
  term_types?: {
    id: number
    name: string
    start_date?: string
    end_date?: string
    is_current: boolean
  }
}

// Status Cell Component
function StatusCell({ student }: { student: Student }) {
  // Check for active programs first
  const hasActiveProgram = student.student_program_history?.some(prog => prog.status === 'active')

  // If no active, check for completed programs
  const hasCompletedProgram = !hasActiveProgram &&
    student.student_program_history?.some(prog => prog.status === 'completed')

  // Determine status: active > completed > inactive
  const status = hasActiveProgram ? 'active' : hasCompletedProgram ? 'completed' : 'inactive'
  const variant = hasActiveProgram ? 'default' : 'secondary'

  return (
    <BadgeCell
      value={status}
      variant={variant}
      transform="capitalize"
    />
  )
}

// Program Cell Component with Modal
function ProgramCell({ student }: { student: Student }) {
  const [showProgramHistory, setShowProgramHistory] = useState(false)

  const activePrograms = student.student_program_history?.filter(prog => prog.status === 'active') || []
  const totalPrograms = student.student_program_history?.length || 0
  const hasMultiplePrograms = totalPrograms > 1

  if (activePrograms.length === 0) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowProgramHistory(true)}
        >
          <span className="text-muted-foreground">No active program</span>
        </Button>
        <ProgramHistoryModal
          isOpen={showProgramHistory}
          onOpenChange={setShowProgramHistory}
          student={student}
        />
      </>
    )
  }

  const primaryProgram = activePrograms[0]

  // Create a Badge component for the count icon
  const ProgramCountBadge = hasMultiplePrograms
    ? ({ className }: { className?: string }) => (
      <Badge
        variant="outline"
        className={`w-4 h-4 p-0 text-xs rounded-full ${className || ''}`}
      >
        {totalPrograms}
      </Badge>
    )
    : undefined

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="cursor-pointer"
        onClick={() => setShowProgramHistory(true)}
      >
        <TwoLineTextCell
          mainText={primaryProgram.programs.major}
          mainIcon={ProgramCountBadge}
          secondaryText={primaryProgram.programs.degrees.name}
          secondaryIcon={GraduationCap}
          spacing="tight"
        />
      </Button>
      <ProgramHistoryModal
        isOpen={showProgramHistory}
        onOpenChange={setShowProgramHistory}
        student={student}
      />
    </>
  )
}

// Dynamic data for filter options
interface FilterData {
  termTypes?: Array<{ id: number; name: string; start_date?: string; end_date?: string; is_current: boolean }>
  isLoadingTermTypes?: boolean
}

// Function to create columns with optional callbacks and dynamic filter data
export function createStudentColumns(callbacks?: ColumnCallbacks, filterData?: FilterData): ColumnDef<Student>[] {
  return [
    // Student photo and name (no filter)
    {
      id: "student",
      accessorKey: "users.first_name",
      header: "Student",
      cell: ({ row }) => {
        const student = row.original
        // Convert to UserCell format
        const user = {
          id: student.users.id,
          email: student.users.email,
          first_name: student.users.first_name,
          last_name: student.users.last_name,
          khmer_first_name: student.users.khmer_first_name,
          khmer_last_name: student.users.khmer_last_name,
          avatar_url: student.users.avatar_url
        }
        return <UserCell user={user} />
      },
    },

    // Student ID (no filter)
    {
      accessorKey: "student_id",
      header: "Student ID",
      cell: ({ row }) => (
        <IDCell id={row.getValue("student_id")} />
      ),
    },

    // Programs
    {
      id: "programs",
      accessorKey: "student_program_history",
      header: () => {
        // Fetch actual program types (with degree info)
        const { data: programs, isLoading: isLoadingPrograms } = useStudentPrograms()

        // Convert to dropdown options format with degree as description
        const programOptions = programs?.map((program: { id: number; major: string; degree?: { name: string } }) => ({
          value: program.id.toString(),
          label: program.major,
          description: program.degree?.name || ''
        })) || []

        return (
          <SelectFilterHeader
            title="Programs"
            options={programOptions}
            currentFilter={callbacks?.currentProgramFilter}
            onFilterChange={(value) => {
              callbacks?.onUpdateFilters?.({
                program_id: value ? parseInt(value) : undefined
              })
            }}
            onClearFilter={() => {
              callbacks?.onUpdateFilters?.({
                program_id: undefined
              })
            }}
            disabled={isLoadingPrograms}
          />
        )
      },
      cell: ({ row }) => {
        const student = row.original
        return <ProgramCell student={student} />
      },
    },

    // Status with filter
    {
      id: "status",
      accessorKey: "student_program_history",
      header: () => {
        if (!callbacks?.onFilterByStatus) {
          return <span className="font-medium">Status</span>
        }

        return (
          <SelectFilterHeader
            title="Statuses"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "completed", label: "Completed" },
            ]}
            currentFilter={callbacks?.currentStatusFilter}
            onFilterChange={(value) => callbacks?.onFilterByStatus?.(value)}
            onClearFilter={() => callbacks?.onFilterByStatus?.("")}
          />
        )
      },
      cell: ({ row }) => {
        const student = row.original
        return <StatusCell student={student} />
      },
    },

    // Admission Term with filter
    {
      id: "admission_term",
      accessorKey: "term_types.name",
      header: () => {
        if (!callbacks?.onFilterByAdmissionTerm) {
          return <span className="font-medium">Admission Term</span>
        }

        return (
          <SelectFilterHeader
            title="Admission Terms"
            options={filterData?.termTypes?.map(termType => ({
              value: termType.name,
              label: termType.name
            })) || []}
            currentFilter={callbacks?.currentAdmissionTermFilter}
            onFilterChange={(value) => callbacks?.onFilterByAdmissionTerm?.(value)}
            onClearFilter={() => callbacks?.onFilterByAdmissionTerm?.("")}
            disabled={filterData?.isLoadingTermTypes}
          />
        )
      },
      cell: ({ row }) => {
        const student = row.original
        if (!student.term_types) {
          return <span className="text-muted-foreground">—</span>
        }

        return (student.term_types.name)
      },
    },

    // Registered Date with filter
    {
      accessorKey: "created_at",
      header: () => {
        if (!callbacks?.onFilterByCreatedDate) {
          return <span className="font-medium">Registered Date</span>
        }

        // Convert string date filter to Date object for DateFilterHeader
        const currentDateFilter = callbacks?.currentCreatedDateFilter
          ? new Date(callbacks.currentCreatedDateFilter)
          : undefined

        return (
          <DateFilterHeader
            title="Created Dates"
            currentFilter={currentDateFilter}
            onFilterChange={(date) => {
              if (date) {
                callbacks?.onFilterByCreatedDate?.(formatISO(date))
              } else {
                callbacks?.onFilterByCreatedDate?.("")
              }
            }}
            maxDate={new Date()}
          />
        )
      },
      cell: ({ row }) => {
        const date = row.getValue("created_at") as string
        if (!date) return <span className="text-muted-foreground">—</span>

        try {
          return format(parseISO(date), "MMM dd, yyyy")
        } catch {
          return <span className="text-muted-foreground">Invalid date</span>
        }
      },
    },

    // Actions
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const student = row.original
        const { hasPermission } = useAuth()

        // Check if user has any permissions for student actions
        const canWrite = hasPermission(PERMISSIONS.STUDENT_MANAGEMENT.WRITE)
        const canDelete = hasPermission(PERMISSIONS.STUDENT_MANAGEMENT.DELETE)
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

              {/* Manage Programs - Requires WRITE access */}
              {canWrite && (
                <DropdownMenuItem onClick={() => callbacks?.onManagePrograms?.(student)}>
                  <BookIcon className="mr-2 h-4 w-4" />
                  Manage Programs
                </DropdownMenuItem>
              )}

              {/* Delete Student - Requires DELETE access */}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => callbacks?.onDeleteStudent?.(student)}
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
export const studentColumns = createStudentColumns()

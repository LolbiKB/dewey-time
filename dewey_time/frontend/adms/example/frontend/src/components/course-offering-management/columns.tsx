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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"
import { IDCell, BadgeCell, SelectFilterHeader, TwoLineTextCell } from "@/components/ui/table-components"
import { useCourseOfferingTerms, useCourseOfferingInstructors } from "@/hooks/use-course-offerings"
import { format, parse, setDay } from "date-fns"

export interface CourseOffering {
  id: number
  course_id: number
  term_id: number
  section: string
  instructor_id: number | null
  location: string | null
  max_enrollment: number | null
  min_enrollment: number | null
  status: string
  google_classroom_id: string | null
  created_at: string
  updated_at: string

  // Related data
  courses: {
    id: number
    course_code: string
    course_name: string
  } | null

  term_types: {
    id: number
    name: string
  } | null

  employees: {
    id: number
    employee_id: string
    users: {
      first_name: string
      last_name: string
    } | null
  } | null

  course_schedules: Array<{
    id: number
    day_of_week: number
    start_time: string
    end_time: string
  }>

  enrollment_count?: number
}

// Helper to format day of week using date-fns
const formatDayOfWeek = (day: number): string => {
  // Create a date and set it to the specified day of week (0 = Sunday, 6 = Saturday)
  const date = setDay(new Date(), day)
  return format(date, 'EEE') // Returns 'Sun', 'Mon', 'Tue', etc.
}

// Helper to format time using date-fns
const formatTime = (time: string): string => {
  if (!time) return '--:--'

  try {
    // Parse time in format "HH:mm:ss" and format as "HH:mm"
    const date = parse(time, 'HH:mm:ss', new Date())
    return format(date, 'HH:mm')
  } catch {
    // If parsing fails, try to extract HH:mm from string
    if (time.includes(':')) {
      const parts = time.split(':')
      if (parts.length >= 2) {
        return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
      }
    }
    return '--:--'
  }
}

// Helper to format schedule
const formatSchedule = (schedules: CourseOffering['course_schedules']): string => {
  if (!schedules || schedules.length === 0) return 'No schedule'

  // Group by time slots
  const timeSlots = new Map<string, number[]>()

  schedules.forEach(schedule => {
    const timeKey = `${formatTime(schedule.start_time)}-${formatTime(schedule.end_time)}`
    if (!timeSlots.has(timeKey)) {
      timeSlots.set(timeKey, [])
    }
    timeSlots.get(timeKey)!.push(schedule.day_of_week)
  })

  // Format each time slot
  const formatted: string[] = []
  timeSlots.forEach((days, time) => {
    const sortedDays = days.sort((a, b) => a - b)
    const dayStr = sortedDays.map(formatDayOfWeek).join('/')
    formatted.push(`${dayStr} ${time}`)
  })

  return formatted.join(', ')
}

interface ColumnsProps {
  onEdit?: (offering: CourseOffering) => void
  onDelete?: (offering: CourseOffering) => void
  onFilterByTerm?: (termId: string) => void
  onFilterByInstructor?: (instructorId: string) => void
  onFilterByStatus?: (status: string) => void
  currentTermFilter?: string
  currentInstructorFilter?: string
  currentStatusFilter?: string
}

export const createColumns = ({
  onEdit,
  onDelete,
  onFilterByTerm,
  onFilterByInstructor,
  onFilterByStatus,
  currentTermFilter,
  currentInstructorFilter,
  currentStatusFilter,
}: ColumnsProps = {}): ColumnDef<CourseOffering>[] => [
    {
      accessorKey: "courses.course_code",
      header: "Course",
      cell: ({ row }) => {
        const courseCode = row.original.courses?.course_code
        const courseName = row.original.courses?.course_name

        if (!courseCode) {
          return <span className="text-muted-foreground">—</span>
        }

        return (
          <TwoLineTextCell
            mainText={courseCode}
            secondaryText={courseName}
            mainClassName="font-mono"
            secondaryClassName="text-muted-foreground"
          />
        )
      },
    },
    {
      accessorKey: "section",
      header: "Section",
      cell: ({ row }) => (
        <BadgeCell value={row.getValue("section")} />
      ),
    },
    {
      id: "term",
      accessorKey: "term_types.name",
      header: () => {
        if (!onFilterByTerm) {
          return <span className="font-medium">Term</span>
        }

        const { data: terms, isLoading } = useCourseOfferingTerms()

        return (
          <SelectFilterHeader
            title="Term"
            options={terms?.map(term => {
              return {
                value: term.id.toString(),
                label: term.is_active ? `${term.name} (Active)` : term.name,
              }
            }) || []}
            currentFilter={currentTermFilter}
            onFilterChange={(value) => onFilterByTerm?.(value)}
            onClearFilter={() => onFilterByTerm?.("")}
            disabled={isLoading}
          />
        )
      },
      cell: ({ row }) => {
        const term = row.original.term_types?.name
        return term || <span className="text-muted-foreground">—</span>
      },
    },
    {
      id: "instructor",
      accessorKey: "employees",
      header: () => {
        if (!onFilterByInstructor) {
          return <span className="font-medium">Instructor</span>
        }

        const { data: instructors, isLoading } = useCourseOfferingInstructors()

        return (
          <SelectFilterHeader
            title="Instructor"
            options={instructors?.map(instructor => ({
              value: instructor.id.toString(),
              label: `${instructor.first_name} ${instructor.last_name}`
            })) || []}
            currentFilter={currentInstructorFilter}
            onFilterChange={(value) => onFilterByInstructor?.(value)}
            onClearFilter={() => onFilterByInstructor?.("")}
            disabled={isLoading}
          />
        )
      },
      cell: ({ row }) => {
        const employee = row.original.employees
        if (!employee?.users) {
          return <span className="text-muted-foreground">—</span>
        }
        return `${employee.users.first_name} ${employee.users.last_name}`
      },
      filterFn: (row, _id, value) => {
        if (!value) return true
        return row.original.instructor_id?.toString() === value
      },
    },
    {
      accessorKey: "course_schedules",
      header: "Schedule",
      cell: ({ row }) => {
        const schedules = row.original.course_schedules
        return (
          <div className="max-w-[200px] min-w-[150px]">
            <span className="text-sm break-words whitespace-normal line-clamp-3">
              {formatSchedule(schedules)}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: "enrollment",
      header: "Enrollment",
      cell: ({ row }) => {
        const current = row.original.enrollment_count || 0
        const max = row.original.max_enrollment
        const min = row.original.min_enrollment

        if (!max) {
          return <span className="text-muted-foreground">—</span>
        }

        const enrollmentText = `${current}/${max}`

        if (min) {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">{enrollmentText}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Min: {min}</p>
              </TooltipContent>
            </Tooltip>
          )
        }

        return <span className="text-sm font-medium">{enrollmentText}</span>
      },
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) => {
        const location = row.getValue("location") as string | null
        return location || <span className="text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: "google_classroom_id",
      header: "Google Classroom",
      cell: ({ row }) => {
        const classroomId = row.getValue("google_classroom_id") as string | null
        return classroomId ? (
          <IDCell id={classroomId} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
    },
    {
      id: "status",
      accessorKey: "status",
      header: () => {
        if (!onFilterByStatus) {
          return <span className="font-medium">Status</span>
        }

        return (
          <SelectFilterHeader
            title="Status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'completed', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
            currentFilter={currentStatusFilter}
            onFilterChange={(value) => onFilterByStatus?.(value)}
            onClearFilter={() => onFilterByStatus?.("")}
          />
        )
      },
      cell: ({ row }) => {
        const status = row.getValue("status") as string
        const variant = status?.toLowerCase() === 'active' ? 'default' : 'secondary'
        return <BadgeCell value={status} variant={variant} />
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const offering = row.original
        const { hasPermission } = useAuth()

        // Check if user has any permissions for course offering actions
        const canWrite = hasPermission(PERMISSIONS.COURSE_MANAGEMENT.WRITE)
        const canDelete = hasPermission(PERMISSIONS.COURSE_MANAGEMENT.DELETE)
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

              {canWrite && onEdit && (
                <DropdownMenuItem onClick={() => onEdit(offering)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}

              {canDelete && onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(offering)}
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

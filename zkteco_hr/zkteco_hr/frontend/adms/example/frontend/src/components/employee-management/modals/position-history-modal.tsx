import { BaseModal } from "@/components/ui/base-modal"
import { Badge } from "@/components/ui/badge"
import { Building2, Calendar, Clock } from "lucide-react"
import { format, parseISO } from "date-fns"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

interface Position {
  id: number
  position_type_id: number
  department_type_id: number | null
  start_date: string
  end_date?: string
  status: 'active' | 'inactive'
  position_types: {
    id: number
    name: string
    description?: string
  }
  department_types: {
    id: number
    name: string
    description?: string
  } | null
}

interface Employee {
  id: number
  employee_id: string
  users: {
    first_name: string
    last_name: string
    khmer_first_name?: string
    khmer_last_name?: string
  }
  employee_positions: Position[]
}

interface PositionHistoryModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  employee?: Employee
}

export function PositionHistoryModal({
  isOpen,
  onOpenChange,
  employee
}: PositionHistoryModalProps) {
  if (!employee) return null

  const englishName = `${employee.users.first_name} ${employee.users.last_name}`
  const khmerName = employee.users.khmer_first_name && employee.users.khmer_last_name
    ? `${employee.users.khmer_first_name} ${employee.users.khmer_last_name}`
    : null
  const displayName = khmerName ? `${englishName} (${khmerName})` : englishName

  // Sort positions by start date (newest first)
  const sortedPositions = [...employee.employee_positions].sort((a, b) =>
    new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
  )

  // Find the latest active position to open by default
  const latestActivePosition = sortedPositions.find(position => position.status === 'active')
  const defaultValue = latestActivePosition ? `position-${latestActivePosition.id}` : undefined

  const formatDate = (dateString: string) => {
    try {
      return format(parseISO(dateString), "MMM dd, yyyy")
    } catch {
      return "Invalid date"
    }
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Position History"
      description={`Position history for ${displayName} (${employee.employee_id})`}
    >
      <div className="space-y-4">
        {sortedPositions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No position history found</p>
          </div>
        ) : (
          <Accordion type="single" collapsible className="w-full" defaultValue={defaultValue}>
            {sortedPositions.map((position) => (
              <AccordionItem
                key={position.id}
                value={`position-${position.id}`}
                className={position.status === 'active' ? "border-primary/50 bg-primary/5 rounded-lg px-3" : "px-3"}
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full mr-4">
                    {/* Left side - Position info */}
                    <div className="flex items-center gap-3">
                      <Building2 className="h-4 w-4" />
                      <div className="text-left">
                        <div className="font-medium">{position.position_types.name}</div>
                        {position.department_types && (
                          <div className="text-sm text-muted-foreground">
                            {position.department_types.name}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right side - Status badges */}
                    <div className="flex items-center gap-2">
                      <Badge variant={position.status === 'active' ? 'default' : 'secondary'}>
                        {position.status.charAt(0).toUpperCase() + position.status.slice(1)}
                      </Badge>
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="flex flex-col gap-1">
                  {/* Date Range */}
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4" />
                    <div>
                      <span className="font-medium">Start:</span> {formatDate(position.start_date)}
                      {position.end_date && (
                        <>
                          <span className="mx-2 text-muted-foreground">•</span>
                          <span className="font-medium">End:</span> {formatDate(position.end_date)}
                        </>
                      )}
                      {!position.end_date && position.status === 'active' && (
                        <>
                          <span className="mx-2 text-muted-foreground">•</span>
                          <span className="text-primary font-medium">Ongoing</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Duration */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>
                      Duration: {(() => {
                        const startDate = new Date(position.start_date)
                        const endDate = position.end_date ? new Date(position.end_date) : new Date()
                        const diffTime = Math.abs(endDate.getTime() - startDate.getTime())
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
                        const years = Math.floor(diffDays / 365)
                        const months = Math.floor((diffDays % 365) / 30)
                        const days = diffDays % 30

                        let duration = ""
                        if (years > 0) duration += `${years} year${years > 1 ? 's' : ''} `
                        if (months > 0) duration += `${months} month${months > 1 ? 's' : ''} `
                        if (days > 0 && years === 0) duration += `${days} day${days > 1 ? 's' : ''}`

                        return duration || "Less than a day"
                      })()}
                    </span>
                  </div>

                  {/* Position Description */}
                  {position.position_types.description && (
                    <div className="text-sm text-muted-foreground border-t bg-muted/30 p-3 rounded-md">
                      <div className="font-medium text-foreground mb-1">Description:</div>
                      <p>{position.position_types.description}</p>
                    </div>
                  )}

                  {/* Department Description */}
                  {position.department_types?.description && (
                    <div className="text-sm text-muted-foreground border-t bg-muted/30 p-3 rounded-md">
                      <div className="font-medium text-foreground mb-1">Department Details:</div>
                      <p>{position.department_types.description}</p>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </BaseModal>
  )
}
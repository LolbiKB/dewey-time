import { BaseModal } from "@/components/ui/base-modal"
import { Badge } from "@/components/ui/badge"
import { BookIcon, Calendar, Clock } from "lucide-react"
import { format, parseISO } from "date-fns"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type { Student } from "../columns"

interface ProgramHistoryModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  student: Student
}

export function ProgramHistoryModal({
  isOpen,
  onOpenChange,
  student
}: ProgramHistoryModalProps) {
  const englishName = `${student.users.first_name} ${student.users.last_name}`
  const khmerName = student.users.khmer_first_name && student.users.khmer_last_name
    ? `${student.users.khmer_first_name} ${student.users.khmer_last_name}`
    : null
  const displayName = khmerName ? `${englishName} (${khmerName})` : englishName

  // Sort programs by start date (newest first)
  const sortedPrograms = [...(student.student_program_history || [])].sort((a, b) =>
    new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
  )

  // Find the latest active program to open by default
  const latestActiveProgram = sortedPrograms.find(program => program.status === 'active')
  const defaultValue = latestActiveProgram ? `program-${latestActiveProgram.id}` : undefined

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
      title="Program History"
      description={`Program history for ${displayName} (${student.student_id})`}
    >
      <div className="space-y-4">
        {sortedPrograms.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <BookIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No program history found</p>
          </div>
        ) : (
          <Accordion type="single" collapsible className="w-full" defaultValue={defaultValue}>
            {sortedPrograms.map((program) => (
              <AccordionItem
                key={program.id}
                value={`program-${program.id}`}
                className={program.status === 'active' ? "border-primary/50 bg-primary/5 rounded-lg px-3" : "px-3"}
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full mr-4">
                    {/* Left side - Program info */}
                    <div className="flex items-center gap-3">
                      <BookIcon className="h-4 w-4" />
                      <div className="text-left">
                        <div className="font-medium">{program.programs.major}</div>
                        <div className="text-sm text-muted-foreground">
                          {program.programs.degrees.name}
                        </div>
                      </div>
                    </div>

                    {/* Right side - Status badges */}
                    <div className="flex items-center gap-2">
                      <Badge variant={program.status === 'active' ? 'default' : 'secondary'}>
                        {program.status.charAt(0).toUpperCase() + program.status.slice(1)}
                      </Badge>
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="flex flex-col gap-1">
                  {/* Date Range */}
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4" />
                    <div>
                      <span className="font-medium">Start:</span> {formatDate(program.start_date)}
                      {program.end_date && (
                        <>
                          <span className="mx-2 text-muted-foreground">•</span>
                          <span className="font-medium">End:</span> {formatDate(program.end_date)}
                        </>
                      )}
                      {!program.end_date && program.status === 'active' && (
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
                        const startDate = new Date(program.start_date)
                        const endDate = program.end_date ? new Date(program.end_date) : new Date()
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

                  {/* Program Description */}
                  {program.programs.description && (
                    <div className="text-sm text-muted-foreground border-t bg-muted/30 p-3 rounded-md">
                      <div className="font-medium text-foreground mb-1">Description:</div>
                      <p>{program.programs.description}</p>
                    </div>
                  )}

                  {/* Department Description */}
                  {program.programs.department_types?.description && (
                    <div className="text-sm text-muted-foreground border-t bg-muted/30 p-3 rounded-md">
                      <div className="font-medium text-foreground mb-1">Department Details:</div>
                      <p>{program.programs.department_types.description}</p>
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

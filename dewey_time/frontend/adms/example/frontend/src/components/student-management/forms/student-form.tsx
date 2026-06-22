import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useEffect } from "react"
import { Info } from "lucide-react"

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { UserCombobox } from "@/components/shared/user-combobox"
import { TermTypeCombobox, ProgramCombobox } from "@/components/student-management/shared/form-comboboxes"
import { studentFormSchema, type StudentFormValues } from "@/schemas/student-validation"
import { fetchAvailableUsers } from "@/services/student-service"

// Mock data interfaces (replace with real API calls)
interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  khmerFirstName?: string
  khmerLastName?: string
  avatarUrl?: string
}

interface TermType {
  id: number
  name: string
  start_date?: string
  end_date?: string
  is_current: boolean
}

interface Program {
  id: number
  major: string
  description?: string
  degree?: {
    id: number
    name: string
    abbreviation?: string
  }
}

interface StudentFormProps {
  defaultValues?: Partial<StudentFormValues>
  onSubmit: (values: StudentFormValues) => void | Promise<void>
  isLoading?: boolean
  formId?: string
  onChangesDetected?: (hasChanges: boolean) => void

  // Data props
  users?: User[]
  termTypes?: TermType[]
  programs?: Program[]
  isLoadingData?: boolean
}

export function StudentForm({
  defaultValues,
  onSubmit,
  isLoading = false,
  formId,
  onChangesDetected,
  users = [],
  termTypes = [],
  programs = [],
  isLoadingData = false
}: StudentFormProps) {

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: {
      user_id: defaultValues?.user_id || "",
      student_id: defaultValues?.student_id || "",
      admission_term_id: defaultValues?.admission_term_id || undefined,
      initial_program: {
        program_id: undefined,
        start_date: undefined
      },
      ...defaultValues,
    },
  })

  // Helper function to transform student ID input
  const transformStudentId = (value: string): string => {
    if (!value) return value

    const trimmed = value.trim()

    // Case 1: Just numbers (1-6 digits) - transform to S-DIU-XXXXXX
    const numbersOnly = trimmed.match(/^\d{1,6}$/)
    if (numbersOnly) {
      return `S-DIU-${trimmed.padStart(6, '0')}`
    }

    // Case 2: S-DIU- followed by 1-6 digits - pad the numbers
    const partialFormat = trimmed.match(/^[sS]-[dD][iI][uU]-(\d{1,6})$/)
    if (partialFormat) {
      const number = partialFormat[1]
      return `S-DIU-${number.padStart(6, '0')}`
    }

    // Case 3: Lowercase format - convert to uppercase
    const lowercaseFormat = trimmed.match(/^[sS]-[dD][iI][uU]-(\d{6})$/)
    if (lowercaseFormat) {
      return `S-DIU-${lowercaseFormat[1]}`
    }

    return trimmed
  }

  // Handle student ID blur event for instant transformation
  const handleStudentIdBlur = (value: string) => {
    const transformed = transformStudentId(value)
    if (transformed !== value) {
      form.setValue('student_id', transformed, { shouldValidate: true })
    }
  }

  // Track form changes
  const { isDirty } = form.formState

  // Report changes back to parent modal
  useEffect(() => {
    if (onChangesDetected) {
      onChangesDetected(isDirty)
    }
  }, [isDirty, onChangesDetected])

  const handleSubmit = async (values: StudentFormValues) => {
    await onSubmit(values)
  }

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6"
        noValidate
      >
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Student Information</h3>

          <FormField
            control={form.control}
            name="user_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Select User *</FormLabel>
                <FormControl>
                  <UserCombobox
                    value={field.value}
                    onValueChange={field.onChange}
                    users={users}
                    disabled={isLoading || isLoadingData}
                    fetchUsers={fetchAvailableUsers}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="student_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Student ID *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="S-DIU-000001"
                    disabled={isLoading}
                    {...field}
                    onBlur={(e) => {
                      handleStudentIdBlur(e.target.value)
                      field.onBlur()
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="admission_term_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Admission Term *</FormLabel>
                <FormControl>
                  <TermTypeCombobox
                    value={field.value}
                    onValueChange={field.onChange}
                    termTypes={termTypes}
                    disabled={isLoading || isLoadingData}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="initial_program.program_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  Initial Program
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Optional. If selected, the program will be set as <strong>active</strong> with today's date as the start date.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </FormLabel>
                <FormControl>
                  <ProgramCombobox
                    value={field.value}
                    onValueChange={field.onChange}
                    programs={programs}
                    disabled={isLoading || isLoadingData}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </form>
    </Form>
  )
}


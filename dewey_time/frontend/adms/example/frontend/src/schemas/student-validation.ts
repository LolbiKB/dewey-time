import { z } from 'zod'

// Student ID validation - S-DIU-000001 format
const STUDENT_ID_REGEX = /^S-DIU-\d{6}$/
const STUDENT_ID_PATTERN = "S-DIU-000001"

// Student creation schema - Business rules only (DB handles FK constraints)
export const createStudentSchema = z.object({
  // User selection (basic validation)
  user_id: z.uuid("Please select a user"),

  // Student ID with specific format and auto-padding (business rule)
  student_id: z
    .string()
    .min(1, "Student ID is required")
    .transform((val) => {
      const trimmed = val.trim()
      
      // Handle various input formats and transform them
      // Case 1: Just numbers (1-6 digits)
      const numbersOnly = trimmed.match(/^\d{1,6}$/)
      if (numbersOnly) {
        return `S-DIU-${trimmed.padStart(6, '0')}`
      }
      
      // Case 2: S-DIU- with any case followed by 1-6 digits
      const partialFormat = trimmed.match(/^[sS]-[dD][iI][uU]-(\d{1,6})$/)
      if (partialFormat) {
        const number = partialFormat[1]
        return `S-DIU-${number.padStart(6, '0')}`
      }
      
      // Case 3: Already correct format but maybe wrong case
      const existingFormat = trimmed.match(/^[sS]-[dD][iI][uU]-(\d{6})$/)
      if (existingFormat) {
        return `S-DIU-${existingFormat[1]}`
      }
      
      return trimmed
    })
    .refine((val) => STUDENT_ID_REGEX.test(val), `Student ID must follow format: ${STUDENT_ID_PATTERN}`),

  // Basic type validation - FK constraints handle existence  
  admission_term_id: z.number(),

  // Initial program enrollment
  initial_program: z.object({
    program_id: z.number(),
    start_date: z.date({ message: "Program start date is required" })
  })
})

// Form schema for React Hook Form (UX-focused validation)
export const studentFormSchema = z.object({
  // User selection - simple validation for dropdown
  user_id: z
    .string()
    .min(1, "Please select a user"),
  
  // Student ID with enhanced transformation and UX validation
  student_id: z
    .string()
    .min(1, "Student ID is required")
    .transform((val) => {
      const trimmed = val.trim()
      
      // Handle various input formats and transform them
      // Case 1: Just numbers (1-6 digits)
      const numbersOnly = trimmed.match(/^\d{1,6}$/)
      if (numbersOnly) {
        return `S-DIU-${trimmed.padStart(6, '0')}`
      }
      
      // Case 2: S-DIU- with any case followed by 1-6 digits
      const partialFormat = trimmed.match(/^[sS]-[dD][iI][uU]-(\d{1,6})$/)
      if (partialFormat) {
        const number = partialFormat[1]
        return `S-DIU-${number.padStart(6, '0')}`
      }
      
      // Case 3: Already correct format but maybe wrong case
      const existingFormat = trimmed.match(/^[sS]-[dD][iI][uU]-(\d{6})$/)
      if (existingFormat) {
        return `S-DIU-${existingFormat[1]}`
      }
      
      return trimmed
    })
    .refine((val) => STUDENT_ID_REGEX.test(val), `Student ID must follow format: ${STUDENT_ID_PATTERN}`)
    .transform((val) => val.trim()),
  
  // Simple validation for dropdown selection
  admission_term_id: z
    .number({ message: "Please select an admission term" }),
  
  initial_program: z.object({
    program_id: z
      .number({ message: "Please select a program" })
      .optional(),
      
    start_date: z.date({ message: "Program start date is required" }).optional()
  }).optional()
})

// Update schema (for future use)
export const updateStudentSchema = createStudentSchema.partial().extend({
  id: z.number().positive("Invalid student ID"),
  student_id: z
    .string()
    .regex(STUDENT_ID_REGEX, `Student ID must follow format: ${STUDENT_ID_PATTERN}`)
    .trim()
    .optional(), // Don't allow changing student_id in updates typically
})

// Program management schema for manage programs modal
export const programManagementSchema = z.object({
  programs: z.array(z.object({
    id: z.number().optional(),
    program_id: z
      .number({ message: "Please select a program" })
      .min(1, "Please select a program"),
    start_date: z.date({ message: "Start date is required" }),
    end_date: z.date().optional(),
    status: z.enum(['active', 'inactive', 'completed'], { message: "Please select a status" })
  }))
  .min(1, "At least one program is required")
  .superRefine((programs, ctx) => {
    programs.forEach((prog, index) => {
      // Validate end dates are after start dates
      if (prog.end_date && prog.start_date && prog.end_date < prog.start_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "End date must be after start date",
          path: [index, 'end_date']
        })
      }
      
      // Validate that completed programs have end dates
      if (prog.status === 'completed' && !prog.end_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "End date is required when status is completed",
          path: [index, 'end_date']
        })
      }
    })
  })
})

// TypeScript type inference
export type CreateStudentInput = z.infer<typeof createStudentSchema>
export type StudentFormValues = z.infer<typeof studentFormSchema>
export type ProgramManagementFormValues = z.infer<typeof programManagementSchema>
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>

// Helper function to format student ID with zero padding
export function formatStudentId(number: number): string {
  return `S-DIU-${number.toString().padStart(6, '0')}`
}

// Helper function to extract number from student ID
export function parseStudentId(studentId: string): number | null {
  const match = studentId.match(/^S-DIU-(\d{6})$/)
  return match ? parseInt(match[1], 10) : null
}

// Helper function to validate student ID format
export function isValidStudentIdFormat(studentId: string): boolean {
  return STUDENT_ID_REGEX.test(studentId)
}

// Export validation constants
export const STUDENT_VALIDATION_CONSTANTS = {
  STUDENT_ID_REGEX,
  STUDENT_ID_PATTERN,
  MAX_FUTURE_START_DATE_YEARS: 1
}

// Export schemas for easy import
export const studentSchemas = {
  create: createStudentSchema,
  form: studentFormSchema,
  update: updateStudentSchema
}

// Validation helpers
export const studentValidationHelpers = {
  formatStudentId,
  parseStudentId,
  isValidStudentIdFormat
}

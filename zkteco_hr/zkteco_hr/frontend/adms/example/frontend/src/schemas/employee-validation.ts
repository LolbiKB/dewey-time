import { z } from 'zod'

// Employee ID validation - E-DIU-000001 format
const EMPLOYEE_ID_REGEX = /^E-DIU-\d{6}$/
const EMPLOYEE_ID_PATTERN = "E-DIU-000001"

// Employee creation schema - Business rules only (DB handles FK constraints)
export const createEmployeeSchema = z.object({
  // User selection (basic validation)
  user_id: z.uuid("Please select a user"),

  // Employee ID with specific format and auto-padding (business rule)
  employee_id: z
    .string()
    .min(1, "Employee ID is required")
    .transform((val) => {
      const trimmed = val.trim()
      
      // Handle various input formats and transform them
      // Case 1: Just numbers (1-6 digits)
      const numbersOnly = trimmed.match(/^\d{1,6}$/)
      if (numbersOnly) {
        return `E-DIU-${trimmed.padStart(6, '0')}`
      }
      
      // Case 2: E-DIU- with any case followed by 1-6 digits
      const partialFormat = trimmed.match(/^[eE]-[dD][iI][uU]-(\d{1,6})$/)
      if (partialFormat) {
        const number = partialFormat[1]
        return `E-DIU-${number.padStart(6, '0')}`
      }
      
      // Case 3: Already correct format but maybe wrong case
      const existingFormat = trimmed.match(/^[eE]-[dD][iI][uU]-(\d{6})$/)
      if (existingFormat) {
        return `E-DIU-${existingFormat[1]}`
      }
      
      return trimmed
    })
    .refine((val) => EMPLOYEE_ID_REGEX.test(val), `Employee ID must follow format: ${EMPLOYEE_ID_PATTERN}`),

  // Basic type validation - FK constraints handle existence  
  hire_term_id: z.number(),

  // Initial position - basic validation
  initial_position: z.object({
    position_type_id: z.number(),
    department_type_id: z.number().optional(),
    start_date: z.date({ message: "Position start date is required" })
  }),

  // Role assignments - basic validation
  role_ids: z.array(z.number()).optional().default([])
})

// Form schema for React Hook Form (UX-focused validation)
export const employeeFormSchema = z.object({
  // User selection - simple validation for dropdown
  user_id: z
    .string()
    .min(1, "Please select a user"),
  
  // Employee ID with enhanced transformation and UX validation
  employee_id: z
    .string()
    .min(1, "Employee ID is required")
    .transform((val) => {
      const trimmed = val.trim()
      
      // Handle various input formats and transform them
      // Case 1: Just numbers (1-6 digits)
      const numbersOnly = trimmed.match(/^\d{1,6}$/)
      if (numbersOnly) {
        return `E-DIU-${trimmed.padStart(6, '0')}`
      }
      
      // Case 2: E-DIU- with any case followed by 1-6 digits
      const partialFormat = trimmed.match(/^[eE]-[dD][iI][uU]-(\d{1,6})$/)
      if (partialFormat) {
        const number = partialFormat[1]
        return `E-DIU-${number.padStart(6, '0')}`
      }
      
      // Case 3: Already correct format but maybe wrong case
      const existingFormat = trimmed.match(/^[eE]-[dD][iI][uU]-(\d{6})$/)
      if (existingFormat) {
        return `E-DIU-${existingFormat[1]}`
      }
      
      return trimmed
    })
    .refine((val) => EMPLOYEE_ID_REGEX.test(val), `Employee ID must follow format: ${EMPLOYEE_ID_PATTERN}`)
    .transform((val) => val.trim()),
  
  // Simple validation for dropdown selection
  hire_term_id: z
    .number({ message: "Please select a hire term" }),
  
  initial_position: z.object({
    position_type_id: z
      .number({ message: "Please select a position" }),
      
    department_type_id: z
      .number({ message: "Please select a department" })
      .optional(), // Truly optional
      
    start_date: z.date({ message: "Position start date is required" })
  }),

  // Role IDs - completely optional (employees can have no roles)
  role_ids: z.array(z.number()).optional()
})

// Update schema (for future use)
export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  id: z.number().positive("Invalid employee ID"),
  employee_id: z
    .string()
    .regex(EMPLOYEE_ID_REGEX, `Employee ID must follow format: ${EMPLOYEE_ID_PATTERN}`)
    .trim()
    .optional(), // Don't allow changing employee_id in updates typically
})

// Position management schema for manage positions modal
export const positionManagementSchema = z.object({
  positions: z.array(z.object({
    id: z.number().optional(),
    position_type_id: z
      .number({ message: "Please select a position" })
      .min(1, "Please select a position"),
    department_type_id: z.number().optional(),
    start_date: z.date({ message: "Start date is required" }),
    end_date: z.date().optional(),
    status: z.enum(['active', 'inactive'], { message: "Please select a status" })
  }))
  .min(1, "At least one position is required")
  .refine((positions) => {
    // Validate end dates are after start dates
    return positions.every(pos => 
      !pos.end_date || !pos.start_date || pos.end_date >= pos.start_date
    )
  }, "End date must be after start date")
})

// TypeScript type inference
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>
export type EmployeeFormValues = z.infer<typeof employeeFormSchema>
export type PositionManagementFormValues = z.infer<typeof positionManagementSchema>
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>

// Helper function to format employee ID with zero padding
export function formatEmployeeId(number: number): string {
  return `E-DIU-${number.toString().padStart(6, '0')}`
}

// Helper function to extract number from employee ID
export function parseEmployeeId(employeeId: string): number | null {
  const match = employeeId.match(/^E-DIU-(\d{6})$/)
  return match ? parseInt(match[1], 10) : null
}

// Helper function to validate employee ID format
export function isValidEmployeeIdFormat(employeeId: string): boolean {
  return EMPLOYEE_ID_REGEX.test(employeeId)
}

// Export validation constants
export const EMPLOYEE_VALIDATION_CONSTANTS = {
  EMPLOYEE_ID_REGEX,
  EMPLOYEE_ID_PATTERN,
  MAX_FUTURE_START_DATE_YEARS: 1
}

// Export schemas for easy import
export const employeeSchemas = {
  create: createEmployeeSchema,
  form: employeeFormSchema,
  update: updateEmployeeSchema
}

// Validation helpers
export const employeeValidationHelpers = {
  formatEmployeeId,
  parseEmployeeId,
  isValidEmployeeIdFormat
}
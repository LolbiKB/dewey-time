import { z } from 'zod'

// Program creation schema - Business rules only (DB handles FK constraints)
export const createProgramSchema = z.object({
  // Program name
  major: z
    .string()
    .min(1, "Program name is required")
    .max(255, "Program name must not exceed 255 characters")
    .trim(),

  // Program description (optional)
  description: z
    .string()
    .max(1000, "Description must not exceed 1000 characters")
    .trim()
    .optional()
    .nullable(),

  // Degree type (required - NOT NULL in DB)
  degree_id: z
    .number({ message: "Please select a degree type" })
    .int()
    .positive("Invalid degree type"),

  // Department (optional - nullable in DB)
  department_type_id: z
    .number()
    .int()
    .positive("Invalid department")
    .optional()
    .nullable(),
})

// Form schema for React Hook Form (UX-focused validation)
export const programFormSchema = z.object({
  // Program name with enhanced UX validation
  major: z
    .string()
    .min(1, "Program name is required")
    .max(255, "Program name must not exceed 255 characters")
    .trim()
    .refine((val) => val.length > 0, "Program name cannot be empty"),

  // Program description (nullable but required in form)
  description: z
    .string()
    .max(1000, "Description must not exceed 1000 characters")
    .trim()
    .transform((val) => val === "" ? null : val)
    .nullable(),

  // Degree type - required field (will error on submit if undefined)
  degree_id: z
    .number({ message: "Please select a degree type" })
    .optional()
    .refine((val) => val !== undefined, "Please select a degree type"),

  // Department - optional field (can be cleared and sent as null to API)
  department_type_id: z
    .number({ message: "Please select a department" })
    .optional(),
})

// Update schema (for future use)
export const updateProgramSchema = createProgramSchema.partial().extend({
  id: z.number().positive("Invalid program ID"),
})

// TypeScript type inference
export type CreateProgramInput = z.infer<typeof createProgramSchema>
export type ProgramFormValues = z.infer<typeof programFormSchema>
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>

// Export validation constants
export const PROGRAM_VALIDATION_CONSTANTS = {
  MAX_NAME_LENGTH: 255,
  MAX_DESCRIPTION_LENGTH: 1000,
}

// Export schemas for easy import
export const programSchemas = {
  create: createProgramSchema,
  form: programFormSchema,
  update: updateProgramSchema,
}

// ============================================================================
// STUDENT PROGRAM MANAGEMENT SCHEMAS
// ============================================================================

/**
 * Schema for a single program entry in student's program history
 */
export const programEntrySchema = z.object({
  id: z.number().optional(), // Existing program history ID
  program_id: z.number().min(1, "Program is required"),
  start_date: z.date(),
  end_date: z.date().optional(),
  status: z.enum(["active", "inactive"])
}).refine(
  (data) => {
    // If end_date exists, it must be after start_date
    if (data.end_date && data.start_date) {
      return data.end_date >= data.start_date
    }
    return true
  },
  {
    message: "End date must be after start date",
    path: ["end_date"]
  }
)

/**
 * Schema for managing multiple programs (program history)
 */
export const programManagementSchema = z.object({
  programs: z.array(programEntrySchema).min(0, "At least one program is recommended")
})

export type ProgramEntryFormValues = z.infer<typeof programEntrySchema>
export type ProgramManagementFormValues = z.infer<typeof programManagementSchema>

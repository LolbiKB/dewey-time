import { z } from 'zod'

// Comprehensive department validation schema following user validation patterns
export const createDepartmentSchema = z.object({
  name: z
    .string()
    .min(1, "Department name is required")
    .max(100, "Too long (max 100 characters)")
    .regex(/^[a-zA-Z0-9\s&'-]+$/, "Invalid characters (letters, numbers, spaces, &, ', - only)")
    .trim()
    .refine((name) => {
      // No consecutive spaces or special characters at start/end
      return !/\s{2,}/.test(name) && !/^[-'\s&]|[-'\s&]$/.test(name)
    }, "Invalid format: no consecutive spaces or special characters at start/end")
    .refine((name) => {
      // Must contain at least one letter
      return /[a-zA-Z]/.test(name)
    }, "Department name must contain at least one letter")
    .refine((name) => {
      // No excessive special characters
      const specialCharCount = (name.match(/[&'-]/g) || []).length
      return specialCharCount <= 3
    }, "Too many special characters"),
  
  description: z
    .string()
    .max(1000, "Description must be less than 1000 characters")
    .trim()
    .transform(val => val === '' || !val ? undefined : val)
    .refine((description) => {
      if (!description) return true
      // Basic content validation - no excessive special characters or HTML-like content
      return !/[<>{}|\\^`]/.test(description) && 
             !/\s{3,}/.test(description) // No more than 2 consecutive spaces
    }, "Description contains invalid characters or excessive spacing")
    .optional(),
})

// Form schema for React Hook Form (same as create schema for departments)
export const departmentFormSchema = createDepartmentSchema

// Update form schema - extends departmentFormSchema with id for edit operations
export const updateDepartmentFormSchema = departmentFormSchema.partial().extend({
  id: z.number().int().positive("Invalid department ID"),
})

// Update department schema (for PATCH/PUT operations)
export const updateDepartmentSchema = createDepartmentSchema.partial().extend({
  id: z.number().int().positive("Invalid department ID"),
})

// TypeScript type inference from schema
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>
export type DepartmentFormValues = z.infer<typeof departmentFormSchema>
export type UpdateDepartmentFormValues = z.infer<typeof updateDepartmentFormSchema>

// Validation constants
export const DEPARTMENT_NAME_MAX_LENGTH = 100
export const DEPARTMENT_DESCRIPTION_MAX_LENGTH = 1000

// Helper function to transform form data for API (no transformation needed for departments)
export function transformFormDataForAPI(data: DepartmentFormValues): CreateDepartmentInput {
  return {
    ...data,
    // Keep empty string as is to explicitly indicate "clear the field"
    // The backend will handle empty strings appropriately
    description: data.description?.trim() || ''
  }
}

// Helper function to transform API data for form (no transformation needed for departments)
export function transformAPIDataForForm(data: any): Partial<DepartmentFormValues> {
  return {
    name: data.name || '',
    description: data.description || '',
  }
}

// Validation helper functions
export const departmentValidationHelpers = {
  transformFormDataForAPI,
  transformAPIDataForForm
}

// Export schemas for easy import
export const departmentSchemas = {
  create: createDepartmentSchema,
  update: updateDepartmentSchema,
  form: departmentFormSchema,
  updateForm: updateDepartmentFormSchema
}

// Export validation constants
export const departmentValidationConfig = {
  DEPARTMENT_NAME_MAX_LENGTH,
  DEPARTMENT_DESCRIPTION_MAX_LENGTH
}
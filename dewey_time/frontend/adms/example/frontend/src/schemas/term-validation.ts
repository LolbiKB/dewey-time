import { z } from "zod"
import { format, parseISO } from "date-fns"

/**
 * Validation configuration constants
 */
export const termValidationConfig = {
  TERM_NAME_MAX_LENGTH: 255,
  TERM_DESCRIPTION_MAX_LENGTH: 1000,
} as const

/**
 * Frontend form schema for term creation/editing
 * Matches backend validation rules
 */
export const termFormSchema = z.object({
  name: z.string()
    .min(1, "Term name is required")
    .max(termValidationConfig.TERM_NAME_MAX_LENGTH, `Name cannot exceed ${termValidationConfig.TERM_NAME_MAX_LENGTH} characters`)
    .trim(),
  start_date: z.date({
    message: "Start date is required",
  }),
  end_date: z.date({
    message: "End date is required",
  }),
  description: z.string()
    .max(termValidationConfig.TERM_DESCRIPTION_MAX_LENGTH, `Description cannot exceed ${termValidationConfig.TERM_DESCRIPTION_MAX_LENGTH} characters`)
    .trim()
    .transform(val => val?.trim() || '')
    .optional(),
}).refine((data) => {
  // Validate that end_date is after start_date
  return data.end_date > data.start_date
}, {
  message: "End date must be after start date",
  path: ["end_date"]
})

export type TermFormValues = z.infer<typeof termFormSchema>

/**
 * Type for API submission (create/update operations)
 * Note: is_current is managed by a dedicated endpoint, not included here
 */
export type CreateTermInput = {
  name: string
  start_date: string
  end_date: string
  description: string | null
}

/**
 * Transform form data to API format
 * Converts Date objects to ISO date strings (YYYY-MM-DD) without timezone shifts
 * Note: is_current is managed by a dedicated endpoint, not included here
 */
export function transformFormDataForAPI(formData: TermFormValues): CreateTermInput {
  return {
    name: formData.name,
    start_date: format(formData.start_date, 'yyyy-MM-dd'),
    end_date: format(formData.end_date, 'yyyy-MM-dd'),
    description: formData.description || null,
  }
}

/**
 * Transform API data to form format
 * Converts ISO date strings to Date objects without timezone shifts
 * Uses date-fns parseISO to handle dates correctly
 */
export function transformAPIDataForForm(apiData: {
  name: string
  start_date: string | null
  end_date: string | null
  description: string | null
  is_current: boolean
}): Partial<TermFormValues> {
  return {
    name: apiData.name,
    start_date: apiData.start_date ? parseISO(apiData.start_date) : undefined,
    end_date: apiData.end_date ? parseISO(apiData.end_date) : undefined,
    description: apiData.description || '',
  }
}

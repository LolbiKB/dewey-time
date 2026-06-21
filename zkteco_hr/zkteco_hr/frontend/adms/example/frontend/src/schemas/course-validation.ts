import { z } from 'zod'

// Base course validation schema
export const courseValidationSchema = z.object({
  course_code: z
    .string()
    .min(1, 'Course code is required')
    .max(50, 'Course code must be at most 50 characters')
    .regex(/^[A-Z0-9-]+$/, 'Course code must contain only uppercase letters, numbers, and hyphens')
    .trim(),
  course_name: z
    .string()
    .min(1, 'Course name is required')
    .max(255, 'Course name must be at most 255 characters')
    .trim(),
  description: z
    .string()
    .max(1000, 'Description is too long')
    .trim()
    .transform((val) => val === "" ? null : val)
    .nullable(),
  credits: z.preprocess(
    (val) => {
      if (val === undefined || val === null || val === '') {
        return undefined
      }
      return val
    },
    z.number()
      .int('Credits must be an integer')
      .min(0, 'Credits must be at least 0')
      .max(12, 'Credits must be at most 12')
  ),
  department_type_id: z
    .number()
    .int('Department type ID must be an integer')
    .positive('Department type ID must be positive')
    .nullable()
    .optional(),
  status: z
    .enum(['active', 'inactive', 'archived'])
    .default('active'),
})

// Schema for creating a new course
export const createCourseValidationSchema = courseValidationSchema

// Schema for updating an existing course
export const updateCourseValidationSchema = courseValidationSchema.partial()

// Type exports
export type CourseFormData = z.infer<typeof courseValidationSchema>
export type CreateCourseFormData = z.infer<typeof createCourseValidationSchema>
export type UpdateCourseFormData = z.infer<typeof updateCourseValidationSchema>

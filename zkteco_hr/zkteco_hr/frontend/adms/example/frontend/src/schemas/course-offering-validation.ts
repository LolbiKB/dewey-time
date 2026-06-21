import { z } from 'zod'

// Schedule slot schema
const scheduleSlotSchema = z.object({
  day_of_week: z.number().min(0).max(6, 'Day must be between 0 (Sunday) and 6 (Saturday)'),
  start_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:mm)'),
  end_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:mm)')
}).refine(
  (data) => {
    // Compare times as strings (works for HH:mm format)
    return data.end_time > data.start_time
  },
  { message: "End time must be after start time", path: ["end_time"] }
)

// Main course offering validation schema for form
export const courseOfferingFormSchema = z.object({
  // Basic Info
  course_id: z.number().positive('Course is required'),
  term_id: z.number().positive('Term is required'),
  section: z.string()
    .min(1, 'Section is required')
    .max(10, 'Section must be 10 characters or less'),
  instructor_id: z.number().nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  
  // Enrollment
  min_enrollment: z.number().min(0).nullable().optional(),
  max_enrollment: z.number().min(1).nullable().optional(),
  status: z.enum(['active', 'completed', 'cancelled']),
  
  // Schedule (required, at least 1)
  schedules: z.array(scheduleSlotSchema)
    .min(1, 'At least one schedule is required')
    .max(20, 'Maximum 20 schedule slots allowed'),
  
  // Google Classroom (optional)
  google_classroom_id: z.string().max(255).nullable().optional()
}).refine(
  (data) => {
    // Validate max_enrollment >= min_enrollment
    if (data.min_enrollment !== null && data.min_enrollment !== undefined &&
        data.max_enrollment !== null && data.max_enrollment !== undefined) {
      return data.max_enrollment >= data.min_enrollment
    }
    return true
  },
  {
    message: 'Maximum enrollment must be greater than or equal to minimum enrollment',
    path: ['max_enrollment']
  }
)

export type CourseOfferingFormData = z.infer<typeof courseOfferingFormSchema>
export type ScheduleSlot = z.infer<typeof scheduleSlotSchema>

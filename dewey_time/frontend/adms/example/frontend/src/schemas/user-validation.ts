import { z } from 'zod'
import { parse, isValid, isBefore, isAfter, subYears, format } from 'date-fns'

// Comprehensive user validation schema - EXACT COPY of backend validation
export const createUserSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .max(255, "Email too long")
    .email("Invalid email format")
    .toLowerCase()
    .trim()
    .refine((email) => {
      // Must be a valid DIU email address ending with @diu.edu.kh
      const diuEmailPattern = /^[a-zA-Z0-9._%+-]+@diu\.edu\.kh$/
      return diuEmailPattern.test(email)
    }, "Must be a DIU email (@diu.edu.kh)"),
  
  firstName: z
    .string()
    .min(1, "First name is required")
    .min(2, "Too short (min 2 characters)")
    .max(50, "Too long (max 50 characters)")
    .regex(/^[a-zA-Z\s'-]+$/, "Invalid characters (letters only)")
    .trim()
    .refine((name) => {
      // No consecutive spaces or special characters
      return !/\s{2,}/.test(name) && !/^[-'\s]|[-'\s]$/.test(name)
    }, "Invalid format"),
  
  lastName: z
    .string()
    .min(1, "Last name is required")
    .min(2, "Too short (min 2 characters)")
    .max(50, "Too long (max 50 characters)")
    .regex(/^[a-zA-Z\s'-]+$/, "Invalid characters (letters only)")
    .trim()
    .refine((name) => {
      // No consecutive spaces or special characters
      return !/\s{2,}/.test(name) && !/^[-'\s]|[-'\s]$/.test(name)
    }, "Invalid format"),
  
  khmerFirstName: z
    .string()
    .max(50, "Must be less than 50 characters")
    .regex(/^[\u1780-\u17FF\s]*$/, "Can only contain Khmer characters")
    .trim()
    .transform(val => val?.trim() || '')
    .refine((name) => {
      if (name && !/\s{2,}/.test(name)) return true
      return name === ''
    }, "Khmer first name cannot have consecutive spaces")
    .optional(),
  
  khmerLastName: z
    .string()
    .max(50, "Khmer last name must be less than 50 characters")
    .regex(/^[\u1780-\u17FF\s]*$/, "Can only contain Khmer characters")
    .trim()
    .transform(val => val?.trim() || '')
    .refine((name) => {
      if (name && !/\s{2,}/.test(name)) return true
      return name === ''
    }, "Khmer last name cannot have consecutive spaces")
    .optional(),
  
  gender: z
    .enum(["male", "female", "other"], { 
      message: "Gender must be male, female, or other" 
    })
    .optional(),
  
  phone: z
    .string()
    .trim()
    .transform(val => val?.trim() || '')
    .refine((phone) => {
      if (!phone) return true // Allow empty string
      // Check max length
      if (phone.length > 20) return false
      // Check format
      if (!/^\+?[1-9]\d{1,14}$/.test(phone)) return false
      // Check reasonable length
      const cleanPhone = phone.replace(/^\+/, '')
      return cleanPhone.length >= 8 && cleanPhone.length <= 15
    }, {
      message: "Invalid phone format"
    })
    .optional(),
  
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in YYYY-MM-DD format")
    .transform(val => val?.trim() || '')
    .refine((date) => {
      if (!date) return true
      const parsed = parse(date, 'yyyy-MM-dd', new Date())
      const now = new Date()
      const minDate = parse('1900-01-01', 'yyyy-MM-dd', new Date())
      const maxAgeDate = subYears(now, 120) // Max 120 years old
      
      // Check if it's a valid date and within reasonable range
      return isValid(parsed) && 
             isBefore(parsed, now) && 
             isAfter(parsed, maxAgeDate) && 
             isAfter(parsed, minDate)
    }, "Date of birth must be between 1900-01-01 and today, and person cannot be over 120 years old")
    .optional(),
  
  address: z
    .string()
    .max(500, "Address must be less than 500 characters")
    .trim()
    .transform(val => val?.trim() || '')
    .refine((address) => {
      if (!address) return true
      // Basic address validation - no excessive special characters
      return !/[<>{}|\\^`]/.test(address)
    }, "Address contains invalid characters")
    .optional(),

  // Frontend-specific file validation (File object instead of Buffer)
  avatar: z
    .instanceof(File)
    .optional()
    .refine((file) => {
      if (!file) return true
      return file.size <= 3 * 1024 * 1024 // 3MB limit to match backend
    }, "Avatar image must be less than 3MB")
    .refine((file) => {
      if (!file) return true
      // Only WebP allowed since frontend should convert to WebP
      return file.type === 'image/webp'
    }, "Avatar must be a WebP image. Please upload a JPEG or PNG and it will be converted.")
})

// Form schema that handles Date objects for date picker compatibility
export const userFormSchema = createUserSchema.extend({
  dateOfBirth: z
    .date()
    .optional()
    .refine((date) => {
      if (!date) return true
      const now = new Date()
      const minDate = parse('1900-01-01', 'yyyy-MM-dd', new Date())
      const maxAgeDate = subYears(now, 120)
      
      return isBefore(date, now) && isAfter(date, maxAgeDate) && isAfter(date, minDate)
    }, "Date of birth must be between 1900-01-01 and today, and person cannot be over 120 years old")
})

// Update form schema - extends userFormSchema with id and clearAvatar
export const updateUserFormSchema = userFormSchema.partial().extend({
  id: z.uuid("Invalid user ID format"),
  clearAvatar: z.boolean().optional(),
  avatarUrl: z.url("Invalid avatar URL").optional() // For displaying existing avatar
})

// Update user schema (for PATCH/PUT operations)
export const updateUserSchema = createUserSchema.partial().extend({
  id: z.uuid("Invalid user ID format"),
  clearAvatar: z.boolean().optional(),
  avatarUrl: z.url("Invalid avatar URL").optional() // For displaying existing avatar
})

// TypeScript type inference from schema
export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type UserFormValues = z.infer<typeof userFormSchema>
export type UpdateUserFormValues = z.infer<typeof updateUserFormSchema>

// File validation constants to match backend
export const MAX_FILE_SIZE = 3 * 1024 * 1024 // 3MB
export const ALLOWED_FILE_TYPES = ['image/webp']
export const ALLOWED_FILE_EXTENSIONS = ['.webp']

// Helper function to convert Date to string for API
export function transformFormDataForAPI(data: UserFormValues): CreateUserInput {
  return {
    ...data,
    dateOfBirth: data.dateOfBirth ? format(data.dateOfBirth, 'yyyy-MM-dd') : '',
  }
}

// Helper function to convert API date string to Date for form
export function transformAPIDataForForm(data: any): Partial<UserFormValues> {
  return {
    ...data,
    dateOfBirth: data.dateOfBirth ? parse(data.dateOfBirth, 'yyyy-MM-dd', new Date()) : undefined,
  }
}

// Validation helper functions
export const userValidationHelpers = {
  transformFormDataForAPI,
  transformAPIDataForForm
}

// Export schemas for easy import
export const userSchemas = {
  create: createUserSchema,
  update: updateUserSchema,
  form: userFormSchema,
  updateForm: updateUserFormSchema
}

export const fileValidationConfig = {
  MAX_FILE_SIZE,
  ALLOWED_FILE_TYPES,
  ALLOWED_FILE_EXTENSIONS
}
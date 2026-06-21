import type { UseFormReturn } from "react-hook-form"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CourseOfferingFormData } from "@/schemas/course-offering-validation"
import {
  CourseCombobox,
  TermCombobox,
  InstructorCombobox
} from "@/components/course-offering-management/shared/form-comboboxes"

interface Course {
  id: number
  course_code: string
  course_name: string
}

interface Term {
  id: number
  name: string
  start_date?: string
  end_date?: string
  is_active: boolean
}

interface Instructor {
  id: number
  employee_id: string
  first_name: string
  last_name: string
}

interface BasicInfoTabProps {
  form: UseFormReturn<CourseOfferingFormData>
  courses: Course[]
  terms: Term[]
  instructors: Instructor[]
  isLoading?: boolean
  isLoadingData?: boolean
  enrollmentCount?: number
  mode?: 'create' | 'edit'
}

export function BasicInfoTab({
  form,
  courses,
  terms,
  instructors,
  isLoading = false,
  isLoadingData = false,
  enrollmentCount,
  mode = 'create'
}: BasicInfoTabProps) {
  return (
    <div className="space-y-4">
      {/* Course Selection - Full Width */}
      <FormField
        control={form.control}
        name="course_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Course *</FormLabel>
            <FormControl>
              <CourseCombobox
                value={field.value}
                onValueChange={field.onChange}
                disabled={isLoading || isLoadingData || mode === 'edit'}
                courses={courses}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Term and Section - Grid */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="term_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Term *</FormLabel>
              <FormControl>
                <TermCombobox
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isLoading || isLoadingData || mode === 'edit'}
                  terms={terms}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="section"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Section *</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., A, B, 01, 02"
                  disabled={isLoading || mode === 'edit'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Instructor - Full Width */}
      <FormField
        control={form.control}
        name="instructor_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Instructor</FormLabel>
            <FormControl>
              <InstructorCombobox
                value={field.value}
                onValueChange={field.onChange}
                disabled={isLoading || isLoadingData}
                instructors={instructors}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Location and Status - Grid */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., Room 201, Building A"
                  disabled={isLoading}
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Status *</FormLabel>
              <Select
                disabled={isLoading}
                onValueChange={field.onChange}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Enrollment Limits */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="min_enrollment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Min Enrollment</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="0"
                  disabled={isLoading}
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="max_enrollment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max Enrollment</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="30"
                  disabled={isLoading}
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Current Enrollment (Edit mode only) */}
      {enrollmentCount !== undefined && (
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
          <span>Current Enrollment</span>
          <span className="font-medium">
            {enrollmentCount} / {form.watch('max_enrollment') || '∞'} students
          </span>
        </div>
      )}
    </div>
  )
}

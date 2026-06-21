import type { UseFormReturn } from "react-hook-form"
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import type { CourseOfferingFormData } from "@/schemas/course-offering-validation"
import { ScheduleBuilder } from "../schedule-builder"

interface ScheduleTabProps {
  form: UseFormReturn<CourseOfferingFormData>
}

export function ScheduleTab({ form }: ScheduleTabProps) {
  return (
    <FormField
      control={form.control}
      name="schedules"
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <ScheduleBuilder
              schedules={field.value}
              onChange={field.onChange}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

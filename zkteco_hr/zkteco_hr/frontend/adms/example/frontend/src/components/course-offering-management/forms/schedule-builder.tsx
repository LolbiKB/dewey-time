import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { TimeInput } from "@/components/ui/time-input"
import { Plus, Trash2 } from "lucide-react"
import type { ScheduleSlot } from "@/schemas/course-offering-validation"

interface ScheduleBuilderProps {
  schedules: ScheduleSlot[]
  onChange: (schedules: ScheduleSlot[]) => void
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

export function ScheduleBuilder({ schedules, onChange }: ScheduleBuilderProps) {
  // Group schedules by time slots (schedules with same start/end time)
  const groupedSchedules = schedules.reduce((acc, schedule) => {
    const key = `${schedule.start_time}-${schedule.end_time}`
    if (!acc[key]) {
      acc[key] = {
        start_time: schedule.start_time,
        end_time: schedule.end_time,
        days: []
      }
    }
    acc[key].days.push(schedule.day_of_week)
    return acc
  }, {} as Record<string, { start_time: string; end_time: string; days: number[] }>)

  const slots = Object.values(groupedSchedules)

  const addSlot = () => {
    // Find the next available time slot
    const existingTimes = new Set(slots.map(slot => `${slot.start_time}-${slot.end_time}`))

    // Generate a list of potential times (8:00-17:00 in 1-hour increments)
    const potentialSlots: Array<{ start: string; end: string }> = []
    for (let hour = 8; hour < 17; hour++) {
      const startTime = `${hour.toString().padStart(2, '0')}:00`
      const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`
      potentialSlots.push({ start: startTime, end: endTime })
    }

    // Find the first available time slot that doesn't exist
    let selectedSlot = potentialSlots.find(
      slot => !existingTimes.has(`${slot.start}-${slot.end}`)
    )

    // If all slots are taken, default to 09:00-10:00 anyway (user can change it)
    if (!selectedSlot) {
      selectedSlot = { start: '09:00', end: '10:00' }
    }

    const newSchedule: ScheduleSlot = {
      day_of_week: 1, // Monday
      start_time: selectedSlot.start,
      end_time: selectedSlot.end
    }
    onChange([...schedules, newSchedule])
  }

  const removeSlot = (slotIndex: number) => {
    const slot = slots[slotIndex]
    // Remove all schedules that match this time slot
    const filtered = schedules.filter(
      s => !(s.start_time === slot.start_time && s.end_time === slot.end_time)
    )
    onChange(filtered)
  }

  const updateSlotDays = (slotIndex: number, days: number[]) => {
    const slot = slots[slotIndex]
    // Remove old schedules for this time slot
    const filtered = schedules.filter(
      s => !(s.start_time === slot.start_time && s.end_time === slot.end_time)
    )
    // Add new schedules for selected days
    const newSchedules = days.map(day => ({
      day_of_week: day,
      start_time: slot.start_time,
      end_time: slot.end_time
    }))
    onChange([...filtered, ...newSchedules])
  }

  const updateSlotTime = (slotIndex: number, field: 'start_time' | 'end_time', value: string) => {
    const slot = slots[slotIndex]
    // Update all schedules for this time slot
    const updated = schedules.map(s => {
      if (s.start_time === slot.start_time && s.end_time === slot.end_time) {
        return { ...s, [field]: value }
      }
      return s
    })
    onChange(updated)
  }

  const toggleDay = (slotIndex: number, day: number) => {
    const slot = slots[slotIndex]
    const currentDays = slot.days
    const newDays = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day].sort((a, b) => a - b)

    // Don't allow removing all days
    if (newDays.length === 0) return

    updateSlotDays(slotIndex, newDays)
  }

  return (
    <div className="space-y-4">
      {slots.length === 0 && (
        <div className="rounded-lg border border-muted bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            No schedules added yet. Click "Add Time Slot" to create a schedule.
          </p>
        </div>
      )}

      {slots.map((slot, index) => (
        <div key={`${slot.start_time}-${slot.end_time}`} className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Time Slot {index + 1}</Label>
            <Button
              type="button"
              variant="ghost"
              onClick={() => removeSlot(index)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Days Selection */}
          <div>
            <Label className="text-sm mb-2 block">Days</Label>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => (
                <div key={day.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`slot-${index}-day-${day.value}`}
                    checked={slot.days.includes(day.value)}
                    onCheckedChange={() => toggleDay(index, day.value)}
                  />
                  <label
                    htmlFor={`slot-${index}-day-${day.value}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {day.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Time Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor={`slot-${index}-start`} className="text-sm mb-1 block">
                Start Time
              </Label>
              <TimeInput
                id={`slot-${index}-start`}
                value={slot.start_time}
                onChange={(e) => updateSlotTime(index, 'start_time', e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <Label htmlFor={`slot-${index}-end`} className="text-sm mb-1 block">
                End Time
              </Label>
              <TimeInput
                id={`slot-${index}-end`}
                value={slot.end_time}
                onChange={(e) => updateSlotTime(index, 'end_time', e.target.value)}
                className="w-full"
              />
            </div>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={addSlot}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Time Slot
      </Button>
    </div>
  )
}

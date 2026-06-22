"use client"

import * as React from "react"
import { CalendarIcon, X } from "lucide-react"
import { format, parse, isValid } from "date-fns"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

function formatDate(date: Date | undefined, formatStr: string = "MMMM dd, yyyy") {
  if (!date) {
    return ""
  }

  try {
    return format(date, formatStr)
  } catch {
    return ""
  }
}

function isValidDate(date: Date | undefined) {
  if (!date) {
    return false
  }
  return isValid(date) && !isNaN(date.getTime())
}

/**
 * Auto-format input based on the date format pattern
 * Adds separators automatically as user types
 */
function autoFormatInput(input: string, formatStr: string): string {
  // Remove all non-digit characters
  const digitsOnly = input.replace(/\D/g, '')

  // Get separator from format (/, -, or .)
  const separator = formatStr.match(/[\/\-\.]/)?.[0] || '/'

  // Build formatted string based on format pattern
  let formatted = ''
  let digitIndex = 0

  for (let i = 0; i < formatStr.length && digitIndex < digitsOnly.length; i++) {
    const formatChar = formatStr[i]

    if (formatChar === '/' || formatChar === '-' || formatChar === '.') {
      // Add separator
      if (formatted.length > 0 && digitIndex > 0) {
        formatted += separator
      }
    } else if (/[dMy]/.test(formatChar)) {
      // Add digit
      if (digitIndex < digitsOnly.length) {
        formatted += digitsOnly[digitIndex]
        digitIndex++
      }
    }
  }

  return formatted
}

/**
 * Check if input matches the expected format pattern
 */
function matchesFormat(input: string, formatStr: string): boolean {
  // Get expected length (e.g., "dd/MM/yyyy" = 10 chars)
  const expectedLength = formatStr.length

  // Input must be at least the expected length
  if (input.length < expectedLength) {
    return false
  }

  // Check if input has separators in the right positions
  for (let i = 0; i < formatStr.length; i++) {
    const formatChar = formatStr[i]
    const inputChar = input[i]

    // If format expects a separator, input must have it
    if (formatChar === '/' || formatChar === '-' || formatChar === '.') {
      if (inputChar !== formatChar) {
        return false
      }
    }
    // If format expects a letter (d, M, y), input must have a digit
    else if (/[dMy]/.test(formatChar)) {
      if (!/\d/.test(inputChar || '')) {
        return false
      }
    }
  }

  return true
}
function parseUserInput(input: string, dateFormat: string): Date | null {
  if (!input || input.trim() === '') {
    return null
  }

  const trimmed = input.trim()

  // Only try parsing with the specified format
  // This ensures dates are interpreted correctly based on the chosen format
  try {
    const parsed = parse(trimmed, dateFormat, new Date())
    if (isValidDate(parsed)) {
      return parsed
    }
  } catch {
    // Invalid date for the chosen format
  }

  return null
}

interface DatePickerInputProps {
  /** Current selected date */
  value?: Date
  /** Callback when date changes */
  onChange?: (date: Date | undefined) => void
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Custom class name for the input */
  className?: string
  /** Date format for display (using date-fns format) */
  dateFormat?: string
  /** Minimum selectable date */
  minDate?: Date
  /** Maximum selectable date */
  maxDate?: Date
  /** ID for the input element */
  id?: string
  /** Whether to show the clear button */
  showClear?: boolean
  /** Callback when clear button is clicked */
  onClear?: () => void
}

export function DatePickerInput({
  value,
  onChange,
  placeholder = "Select a date",
  disabled = false,
  className,
  dateFormat = "MMMM dd, yyyy",
  minDate,
  maxDate,
  id,
  showClear = true,
  onClear,
}: DatePickerInputProps) {
  const [open, setOpen] = React.useState(false)
  const [date, setDate] = React.useState<Date | undefined>(value)
  const [month, setMonth] = React.useState<Date | undefined>(value || new Date())
  const [inputValue, setInputValue] = React.useState(formatDate(value, dateFormat))
  const [formatError, setFormatError] = React.useState<string | null>(null)

  // Sync with external value changes
  React.useEffect(() => {
    setDate(value)
    setInputValue(formatDate(value, dateFormat))
    setFormatError(null) // Clear format error when value changes externally
    if (value) {
      setMonth(value)
    }
  }, [value, dateFormat])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value

    // Auto-format the input with separators
    const formatted = autoFormatInput(newValue, dateFormat)
    setInputValue(formatted)

    // If input is empty, clear the date and error, reset calendar to current date
    if (!formatted || formatted.trim() === '') {
      setDate(undefined)
      setMonth(new Date()) // Reset to current month
      setFormatError(null)
      onChange?.(undefined)
      return
    }

    // Only try to parse if the input matches the expected format
    if (!matchesFormat(formatted, dateFormat)) {
      // Still typing, don't show error yet, but reset calendar to current date
      setFormatError(null)
      setMonth(new Date()) // Reset to current month while typing
      return
    }

    // Try to parse the input as a date
    const parsedDate = parseUserInput(formatted, dateFormat)

    if (parsedDate && isValidDate(parsedDate)) {
      // Check if date is within allowed range
      if (minDate && parsedDate < minDate) {
        setFormatError("Date is before minimum allowed date")
        setDate(undefined)
        setMonth(new Date()) // Reset to current month
        onChange?.(undefined)
        return
      }
      if (maxDate && parsedDate > maxDate) {
        setFormatError("Date is after maximum allowed date")
        setDate(undefined)
        setMonth(new Date()) // Reset to current month
        onChange?.(undefined)
        return
      }

      // Valid date
      setDate(parsedDate)
      setMonth(parsedDate)
      setFormatError(null)
      onChange?.(parsedDate)
    } else {
      // Format matched but date is invalid (e.g., 32/13/2025)
      setFormatError(`Invalid date. Please use format: ${dateFormat.toLowerCase()}`)
      setDate(undefined)
      setMonth(new Date()) // Reset to current month
      onChange?.(undefined)
    }
  }

  const handleDateSelect = (selectedDate: Date | undefined) => {
    setDate(selectedDate)
    // Keep the input in the chosen format
    setInputValue(formatDate(selectedDate, dateFormat))
    setFormatError(null) // Clear any format errors
    setOpen(false)
    onChange?.(selectedDate)
  }

  const handleClear = () => {
    if (onClear) {
      onClear()
    } else {
      setDate(undefined)
      setInputValue("")
      setMonth(new Date()) // Reset to current month
      setFormatError(null)
      onChange?.(undefined)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setOpen(true)
    }
    if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex-1">
        <Input
          id={id}
          value={inputValue}
          placeholder={placeholder}
          className={cn("bg-background pr-16", formatError && "border-red-500", className)}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        {/* Clear button */}
        {showClear && date && (
          <Button
            type="button"
            variant="ghost"
            className="absolute top-1/2 right-8 size-6 -translate-y-1/2"
            disabled={disabled}
            onClick={handleClear}
          >
            <X className="size-3.5" />
            <span className="sr-only">Clear date</span>
          </Button>
        )}
        {/* Calendar button */}
        <Popover open={open && !disabled} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="absolute top-1/2 right-2 size-6 -translate-y-1/2"
              disabled={disabled}
            >
              <CalendarIcon className="size-3.5" />
              <span className="sr-only">Select date</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto overflow-hidden p-0"
            align="end"
            alignOffset={-8}
            sideOffset={10}
          >
            <Calendar
              mode="single"
              selected={date}
              captionLayout="dropdown"
              month={month}
              onMonthChange={setMonth}
              onSelect={handleDateSelect}
              disabled={(date) => {
                if (minDate && date < minDate) return true
                if (maxDate && date > maxDate) return true
                return false
              }}
              fromYear={minDate?.getFullYear() || 1900}
              toYear={maxDate?.getFullYear() || 2100}
            />
          </PopoverContent>
        </Popover>
      </div>
      {formatError && (
        <p className="text-sm font-medium text-destructive">{formatError}</p>
      )}
    </div>
  )
}

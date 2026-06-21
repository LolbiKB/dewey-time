import { CalendarIcon, X } from "lucide-react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface DatePickerProps {
  /** The selected date value */
  value: Date | null | undefined
  /** Callback when date changes */
  onChange: (date: Date | null | undefined) => void
  /** Placeholder text when no date is selected */
  placeholder?: string
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Whether to show the clear button */
  showClear?: boolean
  /** Callback when clear button is clicked */
  onClear?: () => void
  /** Function to disable specific dates */
  disabledDates?: (date: Date) => boolean
  /** Whether to show dropdown for month/year selection */
  captionLayout?: "dropdown" | "label" | "dropdown-months" | "dropdown-years"
  /** Alignment of the popover */
  align?: "start" | "center" | "end"
  /** Custom button className */
  buttonClassName?: string
}

/**
 * Reusable date picker component with optional clear button
 * Wraps the Calendar component in a Popover trigger
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled = false,
  showClear = true,
  onClear,
  disabledDates,
  captionLayout = "label",
  align = "start",
  buttonClassName,
}: DatePickerProps) {
  const handleClear = () => {
    if (onClear) {
      onClear()
    } else {
      onChange(null)
    }
  }

  return (
    <div className="flex gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className={cn(
              "pl-3 text-left font-normal",
              !value && "text-muted-foreground",
              showClear && value ? "flex-1" : "w-full",
              buttonClassName
            )}
          >
            {value ? (
              format(value, "PPP")
            ) : (
              <>
                <span>{placeholder}</span>
                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            "w-auto p-0",
            captionLayout === "dropdown" && "overflow-hidden"
          )}
          align={align}
        >
          <Calendar
            mode="single"
            selected={value ?? undefined}
            onSelect={onChange}
            disabled={disabledDates || disabled}
            captionLayout={captionLayout}
            autoFocus
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {showClear && value && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleClear}
          disabled={disabled}
          className="shrink-0"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  )
}

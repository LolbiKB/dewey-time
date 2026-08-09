import { format, parseISO } from "date-fns";
import { CalendarDaysIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DatePickerInputProps = {
  id?: string;
  label?: string;
  /**
   * Accessible name when there is no visible <Label>. The flag queue's toolbar
   * puts three of these on one row and cannot spend 22px of label above each;
   * the name moves onto the control, which is where a screen reader reads it
   * from in either case. Ignored when `label` is set — a visible label already
   * names the control, and two names is worse than one.
   */
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  min?: Date;
  max?: Date;
};

/**
 * Sourced from `Calendar` rather than imported from react-day-picker, which is a
 * transitive dependency we do not declare.
 */
type CalendarDisabled = React.ComponentProps<typeof Calendar>["disabled"];

/**
 * Every branch below is the matcher the spread `{ ...before, ...after }` used to
 * produce at runtime — the spread merely typed as all-optional, which matches
 * none of react-day-picker's `Matcher` variants.
 *
 * With both bounds this stays a single `DateInterval`, deliberately. Given
 * `before <= after` react-day-picker reads the interval as *open*
 * (`isDayBefore || isDayAfter`), disabling everything outside `[min, max]`.
 * Splitting it into `[{ before }, { after }]` would agree in that case but
 * diverge on an inverted range, so the shape is left alone.
 */
function boundsMatcher(min?: Date, max?: Date): CalendarDisabled {
  if (min && max) return { before: min, after: max };
  if (min) return { before: min };
  if (max) return { after: max };
  return undefined;
}

export function DatePickerInput(props: DatePickerInputProps) {
  const [open, setOpen] = React.useState(false);
  const selected = props.value ? parseISO(props.value) : undefined;
  const generatedId = React.useId()
  const labelId = props.id ?? generatedId;

  return (
    <div className={cn("space-y-1.5", props.className)}>
      {props.label ? (
        <Label htmlFor={labelId} className="text-xs">
          {props.label}
        </Label>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={labelId}
            type="button"
            variant="outline"
            disabled={props.disabled}
            aria-label={props.label ? undefined : props.ariaLabel}
            className={cn(
              "h-10 w-full justify-start px-3 font-normal",
              !props.value && "text-muted-foreground"
            )}
          >
            <CalendarDaysIcon className="mr-2 size-4 shrink-0 opacity-60" />
            {props.value
              ? format(selected!, "MMM d, yyyy")
              : (props.placeholder ?? "Pick a date")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
              if (!date) return;
              props.onChange(format(date, "yyyy-MM-dd"));
              setOpen(false);
            }}
            weekStartsOn={1}
            disabled={boundsMatcher(props.min, props.max)}
            defaultMonth={selected ?? props.min}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

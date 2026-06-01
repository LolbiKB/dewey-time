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
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  min?: Date;
  max?: Date;
};

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
            disabled={{
              ...(props.min ? { before: props.min } : {}),
              ...(props.max ? { after: props.max } : {}),
            }}
            defaultMonth={selected ?? props.min}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

import * as React from "react"
import { ClockIcon } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

function TimeInput({
  className,
  groupClassName,
  label,
  id,
  ...props
}: React.ComponentProps<"input"> & {
  label?: string
  groupClassName?: string
}) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      {label ? (
        <Label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
      ) : null}
      <InputGroup
        className={cn("h-10 w-full min-w-[9.5rem] bg-background", groupClassName)}
      >
        <InputGroupInput
          id={inputId}
          type="time"
          className="px-3 text-sm appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
          {...props}
        />
        <InputGroupAddon align="inline-end" className="pr-3">
          <ClockIcon className="size-4 text-muted-foreground" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export { TimeInput }

import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  employeeCommandFilter,
  employeeDisplayName,
  employeeSearchHaystack,
  khmerName,
} from "@/lib/employeeCard";
import { cn } from "@/lib/utils";
import type { CalendarEmployee } from "@/types/calendar";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";
import { EmployeeIdentity, type TailFact } from "@/ui/EmployeeIdentity";

export type EmployeePickerSize = "sm" | "md" | "lg";

/**
 * Width, and only width.
 *
 * Height, avatar and type are identical across all three, because
 * `EmployeeIdentity` is a CONTAINER-QUERY component: it already adapts
 * continuously to the width of its own text stack, and a size token just
 * chooses where on that ladder the picker sits. Scaling the type instead would
 * invalidate every threshold inside it — the Khmer name turns on at a 200px
 * container because the worst-case pair draws 199.9px at 14px semibold, and the
 * tail facts turn on at 120 / 170 / 230 on the same basis.
 *
 * The trigger's own chrome — px-3 (24), the 40px avatar, gap-2.5 (10), gap-3
 * before the chevron (12), and the 16px chevron — costs about 102px before the
 * text stack gets any width. The tokens are deliberately not round numbers:
 * 224px would clear the 120px first rung by two pixels and 336px would clear
 * the 230px third rung by four, which is inside the margin of error of
 * arithmetic. 240 and 352 clear them by eighteen and twenty.
 *
 * That 102px is DERIVED, and e2e/employee-picker.spec.ts measures it in a
 * browser rather than trusting it — the last layout number on this component's
 * neighbourhood that was reasoned rather than measured was wrong.
 *
 * Whole class strings, not composed: Tailwind scans source text, so a computed
 * `w-[${n}px]` produces no CSS at all.
 */
const SIZE_WIDTH: Record<EmployeePickerSize, string> = {
  sm: "w-60 max-w-full",
  md: "w-88 max-w-full",
  lg: "w-full max-w-lg",
};

export type EmployeePickerProps = {
  employees: CalendarEmployee[];
  value: string | null;
  onChange: (id: string) => void;
  /** Width only. Height, avatar and type are identical across all three. */
  size?: EmployeePickerSize;
  isLoading?: boolean;
  /** No popover, no chevron, no combobox role — a plain bordered display. */
  readOnly?: boolean;
  /**
   * Line-two facts in truncation-priority order.
   *
   * Called only when an employee exists, so "drop the tail when nothing is
   * selected" needs no special case at the call site: an unselected trigger
   * would otherwise carry the "Choose an employee" prompt twice.
   */
  tail: (employee: CalendarEmployee) => TailFact[];
  /** Rows failing this render disabled and cannot be chosen. */
  isDisabled?: (employee: CalendarEmployee) => boolean;
  /** Trailing chip on a list row. */
  badge?: (employee: CalendarEmployee) => ReactNode;
  className?: string;
};

/**
 * One employee picker, for every surface that picks one.
 *
 * Was two components — this one and `ScheduleEmployeePicker` — over the same
 * `CalendarEmployee[]` in the same SPA, which had drifted apart in height,
 * avatar size, name font size, popover width, popover alignment, search
 * placeholder, empty-state copy and fact ordering. Some of that was product
 * behaviour and some was accident, and there was no way to tell which by
 * reading either file.
 */
export function EmployeePicker(props: EmployeePickerProps) {
  const size = props.size ?? "md";
  const selected = useMemo(
    () => props.employees.find((e) => e.id === props.value) ?? null,
    [props.employees, props.value],
  );
  const [open, setOpen] = useState(false);
  const disabled = !props.employees.length || props.isLoading;

  const identity = (
    <EmployeeIdentity
      className="min-w-0 flex-1"
      englishName={employeeDisplayName(selected, props.value)}
      // EmployeeIdentity always renders a second line, so with nothing selected
      // the id slot carries the prompt rather than going blank. Keyed off
      // `selected`, not `props.value`: an id that names no employee in the list
      // (still loading, filtered out) should read the same as no id at all, not
      // repeat the bare id that already lost the argument on line one.
      employeeId={selected ? selected.id : "Choose an employee"}
      khmerName={khmerName(selected?.custom_khmer_last_name, selected?.custom_khmer_first_name)}
      avatar={<EmployeeAvatar employee={selected} fallbackId={props.value} className="size-10" />}
      tail={selected ? props.tail(selected) : []}
      // The measurement hook for e2e/employee-picker.spec.ts. This span is a
      // `block` child of EmployeeIdentity's query container, which has no
      // padding, so its width IS the width the container queries see.
      nameSlot="picker-employee-name"
    />
  );

  // `min-h-`, never `h-`: line one's line box is the union of the Latin and
  // Khmer inline boxes and grows with the Khmer face's ascent and descent, and
  // `truncate` has already set overflow:hidden on it. A fixed height clips the
  // coeng subscripts.
  const frame = cn(
    "flex min-h-14 min-w-0 items-center rounded-xl border border-border bg-background",
    SIZE_WIDTH[size],
    disabled && "opacity-50",
    props.className,
  );

  if (props.readOnly) {
    return (
      <div className={cn(frame, "gap-3 overflow-hidden px-3 py-2")}>
        {identity}
        {props.isLoading ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin opacity-60" />
        ) : null}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            frame,
            "h-auto justify-start gap-3 px-3 py-2 font-normal shadow-none hover:bg-muted/50",
          )}
        >
          {identity}
          {props.isLoading ? (
            <Loader2Icon className="size-4 shrink-0 animate-spin opacity-60" />
          ) : (
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-40" />
          )}
        </Button>
      </PopoverTrigger>

      {/* The list has its own width, independent of the trigger. The 22rem
          floor is what stops a `sm` trigger opening a 240px list: you need the
          most information at the moment you are choosing, not after. */}
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[min(100%,22rem)] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command filter={employeeCommandFilter}>
          <CommandInput placeholder="Search name, ID, branch, department…" className="h-10" />
          <CommandList className="max-h-[min(60vh,320px)]">
            <CommandEmpty>No employees match your search.</CommandEmpty>
            <CommandGroup>
              {props.employees.map((employee) => (
                <EmployeeOption
                  key={employee.id}
                  employee={employee}
                  selected={employee.id === props.value}
                  disabled={props.isDisabled?.(employee) === true}
                  tail={props.tail}
                  badge={props.badge?.(employee)}
                  onSelect={() => {
                    props.onChange(employee.id);
                    setOpen(false);
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One row of the picker list.
 *
 * Exported so its rendering can be tested directly: Radix portals
 * server-render to `null`, so anything left inline inside `PopoverContent`
 * never reaches `renderToStaticMarkup` output.
 *
 * The avatar is `size-8` here, not the trigger's `size-10`. The trigger is a
 * page anchor and this is a dense list item — which is also why
 * `EmployeeIdentity` places the avatar OUTSIDE its query container: one
 * threshold measured across the whole box would mean a different text budget
 * on each surface.
 */
export function EmployeeOption(props: {
  employee: CalendarEmployee;
  selected: boolean;
  disabled?: boolean;
  tail: (employee: CalendarEmployee) => TailFact[];
  badge?: ReactNode;
  onSelect: () => void;
}) {
  const { employee } = props;

  return (
    <CommandItem
      value={employeeSearchHaystack(employee)}
      disabled={props.disabled}
      onSelect={() => {
        if (props.disabled) return;
        props.onSelect();
      }}
      className="gap-2 py-2"
    >
      <EmployeeIdentity
        className="min-w-0 flex-1"
        englishName={employeeDisplayName(employee, employee.id)}
        employeeId={employee.id}
        khmerName={khmerName(employee.custom_khmer_last_name, employee.custom_khmer_first_name)}
        avatar={<EmployeeAvatar employee={employee} fallbackId={employee.id} className="size-8" />}
        tail={props.tail(employee)}
      />
      {props.badge}
      {props.selected ? (
        <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      ) : null}
    </CommandItem>
  );
}

/**
 * The neutral "Clock" chip.
 *
 * `list_calendar_employees` sorts employees with shift coverage first, so
 * clock-based people land at the bottom of the list. Without the chip they read
 * as "schedule failed to import". Neutral, never destructive — being
 * clock-based is a fact about the person, not a problem with them.
 */
export function ClockBadge() {
  return (
    <span className="shrink-0 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
      Clock
    </span>
  );
}

import { CheckIcon, ChevronDownIcon, LayoutTemplateIcon, Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatShiftTime12h } from "@/lib/weekSchedule";
import { cn } from "@/lib/utils";
import { AppTooltip } from "@/ui/AppTooltip";
import { formatDayList, type ShiftBlock } from "@/types/schedule";

function fmt12(time: string | null | undefined): string {
  return formatShiftTime12h(time) ?? "—";
}

export type ScheduleTemplateOption = {
  key: string;
  label: string;
  count: number;
  blocks: ShiftBlock[];
  builtin?: boolean;
};

export type WeeklyScheduleTemplatePickerDialogProps = {
  value: string;
  options: ScheduleTemplateOption[];
  onSelect: (key: string) => void;
  loading?: boolean;
  disabled?: boolean;
  triggerClassName?: string;
};

const MANUAL_OPTION: ScheduleTemplateOption = {
  key: "manual",
  label: "Manual",
  count: 0,
  blocks: [],
};

function blockExtras(profile: ShiftBlock["profile"]): string[] {
  const lines: string[] = [];
  if (profile.lunch_start && profile.lunch_end) {
    lines.push(`Lunch ${fmt12(profile.lunch_start)}–${fmt12(profile.lunch_end)}`);
  } else {
    lines.push("No lunch");
  }
  if (profile.grace_minutes) {
    lines.push(`${profile.grace_minutes} min grace`);
  }
  return lines;
}

/** Toolbar label after a template is chosen. */
export function templateCompactTitle(blocks: ShiftBlock[]): string {
  if (!blocks.length) return "Template";
  if (blocks.length === 1) {
    const b = blocks[0]!;
    return `${formatDayList(b.days)} ${fmt12(b.profile.start_time)}–${fmt12(b.profile.end_time)}`;
  }
  return `${blocks.length} shift blocks`;
}

function blocksMatchSearch(blocks: ShiftBlock[], q: string): boolean {
  return blocks.some((block) => {
    if (block.days.some((day) => day.toLowerCase().includes(q))) return true;
    const haystack = [
      formatDayList(block.days),
      fmt12(block.profile.start_time),
      fmt12(block.profile.end_time),
      ...blockExtras(block.profile),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function BlockRow(props: { block: ShiftBlock }) {
  const { block } = props;
  const extras = blockExtras(block.profile);

  return (
    <li className="rounded-lg bg-muted/25 px-3 py-2.5">
      <p className="text-sm font-medium text-foreground">{formatDayList(block.days)}</p>
      <p className="mt-1 text-sm tabular-nums text-muted-foreground">
        {fmt12(block.profile.start_time)} – {fmt12(block.profile.end_time)}
      </p>
      {extras.length ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{extras.join(" · ")}</p>
      ) : null}
    </li>
  );
}

function TemplateCard(props: {
  option: ScheduleTemplateOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const { option } = props;
  const isManual = option.key === "manual";

  return (
    <AppTooltip content={option.label} side="top" disabled={isManual}>
      <button
        type="button"
        onClick={props.onSelect}
        className={cn(
          "relative w-full rounded-xl border p-4 text-left transition-colors",
          "hover:border-primary/35 hover:bg-muted/20",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          props.selected
            ? "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/15"
            : "border-border/70 bg-card/50"
        )}
      >
      {props.selected ? (
        <span className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-full bg-primary/10">
          <CheckIcon className="size-4 text-primary" aria-label="Selected" />
        </span>
      ) : null}

      {isManual ? (
        <div className={cn("pr-10", props.selected && "pr-12")}>
          <p className="text-sm font-semibold text-foreground">Manual</p>
          <p className="mt-1 text-sm text-muted-foreground">Keep your current shift blocks</p>
        </div>
      ) : (
        <div className={cn(props.selected && "pr-10")}>
          {option.builtin ? (
            <p className="mb-3 text-xs text-muted-foreground">Built-in example</p>
          ) : null}
          <ul className="space-y-2">
            {option.blocks.map((block) => (
              <BlockRow key={block.id} block={block} />
            ))}
          </ul>
        </div>
      )}
      </button>
    </AppTooltip>
  );
}

export function WeeklyScheduleTemplatePickerDialog(props: WeeklyScheduleTemplatePickerDialogProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const allOptions = useMemo(
    () => [MANUAL_OPTION, ...props.options.filter((o) => o.key !== "manual")],
    [props.options]
  );

  const selectedOption = useMemo(
    () => allOptions.find((o) => o.key === props.value) ?? MANUAL_OPTION,
    [allOptions, props.value]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((option) => {
      if (option.key === "manual" && "manual".includes(q)) return true;
      if (option.label.toLowerCase().includes(q)) return true;
      return blocksMatchSearch(option.blocks, q);
    });
  }, [allOptions, query]);

  const triggerLabel =
    props.value === "manual" ? "Template" : templateCompactTitle(selectedOption.blocks);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-9 w-full min-w-0 justify-between gap-2",
            props.triggerClassName ?? "sm:w-64"
          )}
          disabled={props.disabled}
        >
          <span className="flex min-w-0 items-center gap-2">
            <LayoutTemplateIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-left font-normal">
              {props.loading ? "Loading…" : triggerLabel}
            </span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </DialogTrigger>

      <DialogContent
        className="flex max-h-[min(88dvh,36rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader className="shrink-0 space-y-1.5 border-b border-border/60 px-5 py-4 text-left">
          <DialogTitle className="text-base">Schedule templates</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Pick a pattern to fill shift blocks. Times shown in 12-hour format.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 px-5 py-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by day or time…"
            className="h-9"
            disabled={props.loading}
          />
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 px-5 pb-5">
            {props.loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading templates…
              </div>
            ) : filteredOptions.length === 0 ? (
              <p className="py-14 text-center text-sm text-muted-foreground">
                No templates match your search.
              </p>
            ) : (
              filteredOptions.map((option) => (
                <TemplateCard
                  key={option.key}
                  option={option}
                  selected={props.value === option.key}
                  onSelect={() => {
                    props.onSelect(option.key);
                    setOpen(false);
                    setQuery("");
                  }}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

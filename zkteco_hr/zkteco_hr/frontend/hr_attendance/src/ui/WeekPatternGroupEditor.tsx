import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimeInput } from "@/components/ui/time-input";
import { cn } from "@/lib/utils";
import {
  WEEKDAYS,
  createShiftBlock,
  formatDayList,
  formatTimeInput,
  type DayValidationIssue,
  type ShiftBlock,
  type Weekday,
} from "@/types/schedule";

const WEEKDAY_SHORT: Record<Weekday, string> = {
  Monday: "Mo",
  Tuesday: "Tu",
  Wednesday: "We",
  Thursday: "Th",
  Friday: "Fr",
  Saturday: "Sa",
  Sunday: "Su",
};

export type WeekPatternGroupEditorProps = {
  blocks: ShiftBlock[];
  onChange: (blocks: ShiftBlock[]) => void;
  validationIssues: DayValidationIssue[];
  disabled?: boolean;
};

export function WeekPatternGroupEditor(props: WeekPatternGroupEditorProps) {
  const { blocks, onChange, validationIssues, disabled = false } = props;

  function updateBlockProfile(blockId: string, patch: Partial<ShiftBlock["profile"]>) {
    onChange(
      blocks.map((block) =>
        block.id === blockId ? { ...block, profile: { ...block.profile, ...patch } } : block
      )
    );
  }

  function toggleDay(blockId: string, weekday: Weekday) {
    onChange(
      blocks.map((block) => {
        if (block.id === blockId) {
          const selected = block.days.includes(weekday);
          return {
            ...block,
            days: selected
              ? block.days.filter((day) => day !== weekday)
              : [...block.days, weekday].sort(
                  (a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)
                ),
          };
        }
        if (block.days.includes(weekday)) {
          return { ...block, days: block.days.filter((day) => day !== weekday) };
        }
        return block;
      })
    );
  }

  function removeBlock(blockId: string) {
    onChange(blocks.filter((block) => block.id !== blockId));
  }

  function addBlock() {
    const lastProfile = blocks[blocks.length - 1]?.profile;
    onChange([...blocks, createShiftBlock(lastProfile ? { profile: { ...lastProfile } } : undefined)]);
  }

  if (!blocks.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-6 py-14 text-center">
        <p className="text-sm font-medium">No shift blocks</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Choose a template above or add a block to define working days and hours.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          disabled={disabled}
          onClick={addBlock}
        >
          <PlusIcon />
          Add shift block
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        const title = block.days.length ? formatDayList(block.days) : `Shift block ${index + 1}`;
        const blockInvalid = block.days.some((day) =>
          validationIssues.some((issue) => issue.weekday === day)
        );

        return (
          <div
            key={block.id}
            className={cn(
              "rounded-xl border border-border/80 bg-card p-5 sm:p-6",
              blockInvalid && "border-destructive/40"
            )}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Same hours on every selected day — maps to one shared PAT.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={() => removeBlock(block.id)}
                aria-label={`Remove ${title}`}
              >
                <Trash2Icon />
              </Button>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              {WEEKDAYS.map((weekday) => {
                const selected = block.days.includes(weekday);
                const takenElsewhere = blocks.some(
                  (other) => other.id !== block.id && other.days.includes(weekday)
                );
                return (
                  <Button
                    key={`${block.id}-${weekday}`}
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    className="h-9 min-w-9 px-2.5"
                    disabled={disabled || (!selected && takenElsewhere)}
                    onClick={() => toggleDay(block.id, weekday)}
                    aria-pressed={selected}
                    aria-label={weekday}
                    title={weekday}
                  >
                    {WEEKDAY_SHORT[weekday]}
                  </Button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <TimeInput
                className="w-full"
                label="Start"
                disabled={disabled}
                value={formatTimeInput(block.profile.start_time)}
                onChange={(e) => updateBlockProfile(block.id, { start_time: e.target.value })}
              />
              <TimeInput
                className="w-full"
                label="End"
                disabled={disabled}
                value={formatTimeInput(block.profile.end_time)}
                onChange={(e) => updateBlockProfile(block.id, { end_time: e.target.value })}
              />
              <TimeInput
                className="w-full"
                label="Lunch start"
                disabled={disabled}
                value={formatTimeInput(block.profile.lunch_start)}
                onChange={(e) =>
                  updateBlockProfile(block.id, { lunch_start: e.target.value || null })
                }
              />
              <TimeInput
                className="w-full"
                label="Lunch end"
                disabled={disabled}
                value={formatTimeInput(block.profile.lunch_end)}
                onChange={(e) =>
                  updateBlockProfile(block.id, { lunch_end: e.target.value || null })
                }
              />
              <div className="min-w-0 space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Grace (min)</Label>
                <Input
                  type="number"
                  min={0}
                  disabled={disabled}
                  className="h-10 w-full min-w-[5rem] px-3"
                  value={block.profile.grace_minutes}
                  onChange={(e) =>
                    updateBlockProfile(block.id, {
                      grace_minutes: Number(e.target.value || 0),
                    })
                  }
                />
              </div>
            </div>

            {blockInvalid ? (
              <p className="mt-4 text-xs text-destructive">
                {validationIssues.find((issue) => block.days.includes(issue.weekday))?.message}
              </p>
            ) : null}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addBlock}>
        <PlusIcon />
        Add shift block
      </Button>
    </div>
  );
}

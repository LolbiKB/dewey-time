import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
};

export function WeekPatternGroupEditor(props: WeekPatternGroupEditorProps) {
  const { blocks, onChange, validationIssues } = props;

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
    const next = blocks.filter((block) => block.id !== blockId);
    onChange(next.length ? next : [createShiftBlock()]);
  }

  function addBlock() {
    onChange([...blocks, createShiftBlock({ profile: { ...blocks[blocks.length - 1]!.profile } })]);
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const title = block.days.length ? formatDayList(block.days) : `Shift block ${index + 1}`;
        const blockInvalid = block.days.some((day) =>
          validationIssues.some((issue) => issue.weekday === day)
        );

        return (
          <div
            key={block.id}
            className={cn(
              "rounded-xl border border-border/80 bg-card p-4",
              blockInvalid && "border-destructive/40"
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">
                  Same hours on every selected day — maps to one shared PAT.
                </p>
              </div>
              {blocks.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeBlock(block.id)}
                  aria-label={`Remove ${title}`}
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </div>

            <div className="mb-4 flex flex-wrap gap-1">
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
                    className="h-8 w-8 px-0"
                    disabled={!selected && takenElsewhere}
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

            <div className="flex flex-wrap items-end gap-3">
              <TimeField
                label="Start"
                value={formatTimeInput(block.profile.start_time)}
                onChange={(value) => updateBlockProfile(block.id, { start_time: value })}
              />
              <TimeField
                label="End"
                value={formatTimeInput(block.profile.end_time)}
                onChange={(value) => updateBlockProfile(block.id, { end_time: value })}
              />
              <TimeField
                label="Lunch start"
                value={formatTimeInput(block.profile.lunch_start)}
                onChange={(value) =>
                  updateBlockProfile(block.id, { lunch_start: value || null })
                }
              />
              <TimeField
                label="Lunch end"
                value={formatTimeInput(block.profile.lunch_end)}
                onChange={(value) => updateBlockProfile(block.id, { lunch_end: value || null })}
              />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Grace</Label>
                <Input
                  type="number"
                  min={0}
                  className="h-8 w-14 px-2"
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
              <p className="mt-2 text-xs text-destructive">
                {validationIssues.find((issue) => block.days.includes(issue.weekday))?.message}
              </p>
            ) : null}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={addBlock}>
        <PlusIcon />
        Add shift block
      </Button>
    </div>
  );
}

function TimeField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{props.label}</Label>
      <Input
        type="time"
        className="h-8 w-[6.75rem]"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

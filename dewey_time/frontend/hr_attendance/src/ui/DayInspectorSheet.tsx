import type { Day, DeviceAlert, DeviceSyncStatus, Flag } from "@/types/calendar";
import { format } from "date-fns";
import { ArrowLeftIcon, ArrowRightIcon, ChevronRightIcon, LogInIcon, LogOutIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatBranchLabel,
  formatCheckinTime,
  formatDurationMinutes,
  formatMinuteOnDay,
} from "@/lib/attendanceTime";
import { directionForCheckin, type Segment as AttendanceSegment } from "@/lib/attendancePunches";
import {
  buildSegmentInspectorItems,
  deriveSegments,
  sortCheckinsByTime,
  type SegmentInspectorItem,
} from "@/lib/segmentInspector";
import { formatFlagLabel, parseFlagEvidence } from "@/lib/flagLabels";
import { flagDialogTitle, formatFlagContextDate, formatFlagStatusLabel, flagIsProvisional } from "@/lib/flagDetails";
import { cn } from "@/lib/utils";
import { DeviceAlertRow } from "@/ui/DeviceAlerts";
import { FlagDetailPanel } from "@/ui/FlagDetailPanel";

type Checkin = NonNullable<Day["checkins"]>[number];
type Severity = "INFO" | "WARNING" | "CRITICAL";

const SEVERITY_ORDER: Severity[] = ["CRITICAL", "WARNING", "INFO"];

export type DayInspectorSheetProps = {
  inspectingDate: string | null;
  employeeId: string | null;
  employeeLabel: string | null;
  inspectingDay?: Day;
  alertsByDate: Map<string, DeviceAlert[]>;
  syncByDate: Map<string, DeviceSyncStatus[]>;
  reviewingFlag: Flag | null;
  onReviewingFlagChange: (flag: Flag | null) => void;
  showDeskReview?: boolean;
  onClose: () => void;
};

export function DayInspectorSheet(props: DayInspectorSheetProps) {
  const [activeTab, setActiveTab] = useState<"timeline" | "punches" | "flags">("timeline");
  const segments = useMemo(
    () => deriveSegments(props.inspectingDay?.checkins ?? []),
    [props.inspectingDay?.checkins]
  );
  const segmentInspectorItems = useMemo(
    () =>
      buildSegmentInspectorItems(
        segments,
        props.inspectingDay?.checkins ?? [],
        {
          dateKey: props.inspectingDate ?? undefined,
          shift: props.inspectingDay?.shift,
          observedLunch: props.inspectingDay?.observed_lunch ?? null,
          deviceSync: props.inspectingDate
            ? (props.syncByDate.get(props.inspectingDate) ?? [])
            : [],
        }
      ),
    [
      props.inspectingDate,
      props.inspectingDay?.checkins,
      props.inspectingDay?.observed_lunch,
      props.inspectingDay?.shift,
      props.syncByDate,
      segments,
    ]
  );

  const punches = sortCheckinsByTime(props.inspectingDay?.checkins ?? []);
  const dayAlerts = props.inspectingDate
    ? (props.alertsByDate.get(props.inspectingDate) ?? [])
    : [];
  const flags = [...(props.inspectingDay?.flags ?? [])].sort((a, b) => {
    const aIdx = SEVERITY_ORDER.indexOf((a.severity ?? "WARNING") as Severity);
    const bIdx = SEVERITY_ORDER.indexOf((b.severity ?? "WARNING") as Severity);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (a.flag_code ?? "").localeCompare(b.flag_code ?? "");
  });

  return (
    <Sheet open={!!props.inspectingDate} onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent side="right" className="flex w-[440px] flex-col overflow-hidden sm:max-w-md">
        <SheetHeader>
          {props.reviewingFlag ? (
            <>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  onClick={() => {
                    props.onReviewingFlagChange(null);
                    setActiveTab("flags");
                  }}
                  aria-label="Back to flags"
                >
                  <ArrowLeftIcon className="size-4" />
                </Button>
                <SheetTitle className="truncate">{flagDialogTitle(props.reviewingFlag)}</SheetTitle>
              </div>
              <SheetDescription asChild>
                <div className="text-sm text-muted-foreground">
                  Attendance flag review · {formatFlagContextDate(props.inspectingDate ?? "")}
                </div>
              </SheetDescription>
            </>
          ) : (
            <>
              <SheetTitle>
                {props.inspectingDate ? format(new Date(props.inspectingDate), "EEE, MMM d") : "Day"}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="text-foreground">
                    {props.employeeLabel ?? props.employeeId ?? "Employee"}
                  </span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>Day inspector</span>
                </div>
              </SheetDescription>
            </>
          )}
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-4 pb-5">
          {props.reviewingFlag && props.inspectingDate ? (
            <FlagDetailPanel
              flag={props.reviewingFlag}
              date={props.inspectingDate}
              employeeLabel={props.employeeLabel}
              employeeId={props.employeeId}
              showDeskReview={props.showDeskReview !== false}
              onViewTimeline={() => {
                props.onReviewingFlagChange(null);
                setActiveTab("timeline");
              }}
            />
          ) : (
          <div className="grid h-full grid-rows-[auto_1fr_auto] gap-3">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="min-h-0">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="timeline" className="gap-2">
                  Segments
                  <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
                    {segmentInspectorItems.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="punches" className="gap-2">
                  Punches
                  <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
                    {punches.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="flags" className="gap-2">
                  Flags
                  <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
                    {flags.length + dayAlerts.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="timeline" className="mt-3 min-h-0">
                <Card className="border-border/60">
                  <CardContent className="space-y-3 pt-4">
                    {segmentInspectorItems.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center">
                        <div className="text-sm font-medium">No timeline items</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          No punches recorded for this day.
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {segmentInspectorItems.map((item, idx) => {
                          if (item.kind === "segment") {
                            return (
                              <SegmentInspectorRow key={`segment-${idx}`} segment={item.segment} />
                            );
                          }
                          if (item.kind === "lunch") {
                            return (
                              <LunchInspectorRow
                                key={`lunch-${idx}`}
                                item={item}
                                dateKey={props.inspectingDate ?? ""}
                              />
                            );
                          }
                          if (item.kind === "away") {
                            return (
                              <AwayInspectorRow
                                key={`away-${idx}`}
                                item={item}
                                dateKey={props.inspectingDate ?? ""}
                              />
                            );
                          }
                          if (item.kind === "openSession") {
                            return (
                              <OpenSessionInspectorRow
                                key={`open-${item.checkin.time}-${idx}`}
                                item={item}
                              />
                            );
                          }
                          return (
                            <UnpairedInspectorRow
                              key={`unpaired-${item.checkin.time}-${idx}`}
                              checkin={item.checkin}
                              isRogue={item.isRogue}
                              direction={directionForCheckin(punches, item.checkin)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="punches" className="mt-3 min-h-0">
                <Card className="border-border/60">
                  <CardContent className="pt-4">
                    {punches.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center">
                        <div className="text-sm font-medium">No punches</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          There are no checkins recorded for this day.
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {punches.map((checkin, idx) => (
                          <PunchInspectorRow
                            key={checkin.name ?? `${checkin.time}-${idx}`}
                            checkin={checkin}
                            index={idx + 1}
                            direction={directionForCheckin(punches, checkin)}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="flags" className="mt-3 min-h-0">
                <Card className="border-border/60">
                  <CardContent className="pt-4">
                    <div className="text-sm font-medium">Flags</div>
                    {dayAlerts.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        <div className="text-xs font-medium text-muted-foreground">
                          Device closeout
                        </div>
                        {dayAlerts.map((alert) => (
                          <DeviceAlertRow key={`${alert.device_sn}-${alert.local_date}`} alert={alert} />
                        ))}
                      </div>
                    ) : null}
                    {flags.length === 0 && dayAlerts.length === 0 ? (
                      <div className="mt-3 rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center">
                        <div className="text-sm font-medium">No flags</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          No attendance flags for this day.
                        </div>
                      </div>
                    ) : flags.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {flags.map((f) => (
                          <FlagInspectorRow
                            key={f.name}
                            flag={f}
                            onOpen={() => props.onReviewingFlagChange(f)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function SegmentInspectorRow(props: { segment: AttendanceSegment }) {
  const { segment } = props;
  const branch = formatBranchLabel(segment.branch);

  return (
    <div className="flex gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 shadow-xs">
      <div className="mt-0.5 flex w-8 shrink-0 flex-col items-center gap-1">
        <div className="h-full min-h-10 w-1 rounded-full bg-primary" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold tracking-tight">
              <span>{formatCheckinTime(segment.start?.time ?? null)}</span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{formatCheckinTime(segment.end?.time ?? null)}</span>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold">
            {formatDurationMinutes(segment.minutes)}
          </Badge>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px] font-semibold">
              IN
            </Badge>
            <ArrowRightIcon className="size-3 text-muted-foreground" aria-hidden="true" />
            <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px] font-semibold">
              OUT
            </Badge>
          </div>
          {branch ? (
            <span className="shrink-0 text-right text-xs text-muted-foreground">{branch}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LunchInspectorRow(props: {
  item: Extract<SegmentInspectorItem, { kind: "lunch" }>;
  dateKey: string;
}) {
  const { item, dateKey } = props;
  const startLabel =
    item.source === "observed" && item.observed?.lunch_out
      ? formatCheckinTime(item.observed.lunch_out)
      : formatMinuteOnDay(dateKey, item.startMin);
  const endLabel =
    item.source === "observed" && item.observed?.lunch_in
      ? formatCheckinTime(item.observed.lunch_in)
      : formatMinuteOnDay(dateKey, item.endMin);

  return (
    <div className="flex gap-3 rounded-xl border border-border/60 bg-muted/25 px-3 py-3 shadow-xs">
      <div className="mt-0.5 flex w-8 shrink-0 flex-col items-center gap-1">
        <div className="h-full min-h-10 w-1 rounded-full bg-muted-foreground/40" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold tracking-tight">
              <span>{startLabel}</span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{endLabel}</span>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold"
          >
            {formatDurationMinutes(item.minutes)}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className="h-5 rounded-md px-1.5 text-[10px] font-semibold text-muted-foreground"
          >
            Lunch · {item.source}
          </Badge>
          {item.observed?.late_return ? (
            <Badge
              variant="outline"
              className="h-5 rounded-md border-brand-accent/40 bg-brand-accent/10 px-1.5 text-[10px] font-semibold text-brand-accent"
            >
              Late return
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AwayInspectorRow(props: {
  item: Extract<SegmentInspectorItem, { kind: "away" }>;
  dateKey: string;
}) {
  const { item, dateKey } = props;

  return (
    <div className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3 shadow-xs">
      <div className="mt-0.5 flex w-8 shrink-0 flex-col items-center gap-1">
        <div className="h-full min-h-10 w-1 rounded-full bg-destructive/80" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold tracking-tight text-destructive">
              <span>{formatMinuteOnDay(dateKey, item.startMin)}</span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{formatMinuteOnDay(dateKey, item.endMin)}</span>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="shrink-0 rounded-md border-destructive/30 bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive"
          >
            {formatDurationMinutes(item.minutes)}
          </Badge>
        </div>
        <Badge
          variant="outline"
          className="h-5 rounded-md border-destructive/40 bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive"
        >
          Away
        </Badge>
      </div>
    </div>
  );
}

function OpenSessionInspectorRow(props: {
  item: Extract<SegmentInspectorItem, { kind: "openSession" }>;
}) {
  const { item } = props;
  const branch = formatBranchLabel(item.branch);
  const duration = Math.max(0, item.confirmedEndMin - item.startMin);
  const uncertainMinutes =
    item.uncertainEndMin != null && item.uncertainEndMin > item.confirmedEndMin
      ? item.uncertainEndMin - item.confirmedEndMin
      : null;

  return (
    <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 shadow-xs">
      <div className="mt-0.5 flex w-8 shrink-0 flex-col items-center gap-1">
        <div className="h-full min-h-10 w-1 rounded-full bg-primary" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-foreground">
              On site
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Since {formatCheckinTime(item.checkin.time)}
              {branch ? ` · ${branch}` : null}
            </div>
          </div>
          <Badge
            variant="secondary"
            className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
          >
            {formatDurationMinutes(duration)}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="h-5 rounded-md border-primary/30 bg-primary/10 px-1.5 text-[10px] font-semibold text-primary"
          >
            Open session
          </Badge>
          {item.syncLagging ? (
            <Badge
              variant="outline"
              className="h-5 rounded-md border-brand-accent/40 bg-brand-accent/10 px-1.5 text-[10px] font-semibold text-brand-accent"
            >
              Sync pending
              {uncertainMinutes != null ? ` · ${formatDurationMinutes(uncertainMinutes)}` : null}
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function UnpairedInspectorRow(props: {
  checkin: Checkin;
  isRogue: boolean;
  direction: "IN" | "OUT";
}) {
  const branch = formatBranchLabel(props.checkin.custom_device_branch);
  const label = props.isRogue ? "Rogue punch" : "Unpaired punch";

  return (
    <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3 shadow-xs">
      <div className="mt-0.5 flex w-8 shrink-0 flex-col items-center gap-1">
        <div className="h-full min-h-10 w-1 rounded-full bg-destructive" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-sm font-semibold tracking-tight text-destructive">
            {formatCheckinTime(props.checkin.time)}
          </div>
          <Badge
            variant="outline"
            className="shrink-0 rounded-md border-destructive/30 bg-background/80 px-2 py-0.5 text-[11px] font-semibold text-destructive"
          >
            {props.direction}
          </Badge>
        </div>
        <div className="flex items-end justify-between gap-3">
          <Badge
            variant="outline"
            className="h-5 rounded-md border-destructive/30 bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive"
          >
            {label}
          </Badge>
          {branch ? (
            <span className="shrink-0 text-right text-xs text-destructive/70">{branch}</span>
          ) : (
            <span className="shrink-0 text-right text-xs text-destructive/70">No branch</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PunchInspectorRow(props: { checkin: Checkin; index: number; direction: "IN" | "OUT" }) {
  const { checkin, index, direction } = props;
  const isIn = direction === "IN";
  const branch = formatBranchLabel(checkin.custom_device_branch);
  const Icon = isIn ? LogInIcon : LogOutIcon;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 shadow-xs">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
          isIn
            ? "border-primary/20 bg-primary/10 text-primary"
            : "border-border bg-muted/40 text-muted-foreground"
        )}
        aria-label={direction}
      >
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold tracking-tight">{formatCheckinTime(checkin.time)}</div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">#{index}</span>
          {branch ? (
            <span className="shrink-0 text-right text-xs text-muted-foreground">{branch}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FlagInspectorRow(props: { flag: Flag; onOpen: () => void }) {
  const { flag } = props;
  const sev = flag.severity ?? "WARNING";
  const provisional = flagIsProvisional(flag);
  const label = formatFlagLabel(flag.flag_code, parseFlagEvidence(flag.evidence));
  const stripeClass =
    sev === "CRITICAL"
      ? "bg-destructive"
      : sev === "WARNING"
        ? "bg-brand-accent"
        : "bg-muted-foreground/50";

  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="flex w-full gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left shadow-xs transition-colors hover:bg-muted/20 focus:outline-hidden focus:ring-2 focus:ring-ring/40"
    >
      <div className="mt-0.5 flex w-8 shrink-0 flex-col items-center gap-1">
        <div className={cn("h-full min-h-10 w-1 rounded-full", stripeClass)} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">{label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {formatFlagStatusLabel(flag.status)}
              {provisional ? " · Provisional" : null}
            </div>
          </div>
          <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "h-5 rounded-md px-1.5 text-[10px] font-semibold",
              sev === "CRITICAL" && "border-destructive/40 text-destructive",
              sev === "WARNING" && "border-brand-accent/40 text-brand-accent",
              sev === "INFO" && "border-border text-muted-foreground"
            )}
          >
            {sev}
          </Badge>
          {provisional ? (
            <Badge
              variant="outline"
              className="h-5 rounded-md border-dashed border-border px-1.5 text-[10px] font-semibold text-muted-foreground"
            >
              Provisional
            </Badge>
          ) : null}
        </div>
      </div>
    </button>
  );
}

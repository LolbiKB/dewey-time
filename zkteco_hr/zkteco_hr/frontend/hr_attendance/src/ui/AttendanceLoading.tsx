import type { ReactNode } from "react";
import { Loader2Icon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function LoadingIndicator(props: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground animate-in fade-in duration-300",
        props.className
      )}
    >
      <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
      {props.label ? <span>{props.label}</span> : null}
    </div>
  );
}

export function AttendanceHeaderSkeleton() {
  return (
    <Card className="border-border/60">
      <CardContent className="py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-11 shrink-0 rounded-full" />
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-[132px] rounded-lg" />
            <Skeleton className="h-7 w-[88px] rounded-lg" />
            <Skeleton className="h-7 w-[72px] rounded-lg" />
            <Skeleton className="h-7 w-[68px] rounded-lg" />
            <Skeleton className="h-7 w-[68px] rounded-lg" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WeekViewSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card animate-in fade-in duration-300">
      <div className="grid shrink-0 grid-cols-7 border-b border-border/60">
        {Array.from({ length: 7 }).map((_, idx) => (
          <div key={idx} className="space-y-2 px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-8" />
                <Skeleton className="size-6 rounded-full" />
              </div>
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-10 rounded-full" />
          </div>
        ))}
      </div>
      <div className="grid min-h-[420px] flex-1 grid-cols-7 gap-px bg-border/40 p-px">
        {Array.from({ length: 7 }).map((_, idx) => (
          <div key={idx} className="flex flex-col gap-2 bg-card p-2">
            <Skeleton className="h-[18%] w-full rounded-sm" />
            <Skeleton className="h-[28%] w-full rounded-sm" />
            <Skeleton className="h-[12%] w-[80%] rounded-sm" />
            <Skeleton className="h-[22%] w-full rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AttendancePageSkeleton(props: { label?: string }) {
  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6">
        <AttendanceHeaderSkeleton />
        <div className="flex min-h-0 flex-1 flex-col">
          <WeekViewSkeleton />
        </div>
        <LoadingIndicator label={props.label} className="justify-center pb-2" />
      </div>
    </div>
  );
}

export function WeekViewAnimatedShell(props: {
  loading: boolean;
  weekKey: string;
  direction: "prev" | "next" | "jump";
  children: ReactNode;
}) {
  if (props.loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col animate-in fade-in duration-200">
        <WeekViewSkeleton />
      </div>
    );
  }

  return (
    <div
      key={`${props.weekKey}-${props.direction}`}
      className={cn(
        "flex min-h-0 flex-1 flex-col ease-out animate-in fade-in fill-mode-both duration-350",
        props.direction === "next" && "slide-in-from-right-6",
        props.direction === "prev" && "slide-in-from-left-6",
        props.direction === "jump" && "slide-in-from-bottom-2 zoom-in-98"
      )}
    >
      {props.children}
    </div>
  );
}

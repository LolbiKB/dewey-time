import { ChevronRightIcon, CloudOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Role 2 — attention. The data may be stale or incomplete; you might want to
 * act, but nothing is broken.
 *
 * One line at rest. When `detail` is present the header row itself becomes the
 * <summary>, so disclosing never costs a second row. Native <details> gives
 * keyboard operation and expanded-state announcement for free.
 *
 * role="status" is polite on purpose: stale device data must not interrupt a
 * screen reader mid-sentence.
 */
export function AttentionStrip(props: {
  tone: "amber" | "accent";
  icon: React.ReactNode;
  children: React.ReactNode;
  /** When present, the header row becomes a disclosure toggle. */
  detail?: React.ReactNode;
  /** Right-aligned in the header row. */
  count?: number;
}) {
  const tone =
    props.tone === "amber"
      ? "border-amber-500/25 bg-amber-500/[0.06]"
      : "border-brand-accent/30 bg-brand-accent/[0.05]";

  const head = (
    <>
      <span className="shrink-0">{props.icon}</span>
      <span className="min-w-0 flex-1 text-foreground">{props.children}</span>
      {props.count != null ? (
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {props.count}
        </span>
      ) : null}
    </>
  );

  if (!props.detail) {
    return (
      <div
        role="status"
        className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm animate-in fade-in ${tone}`}
      >
        {head}
      </div>
    );
  }

  return (
    <details role="status" className={`group rounded-md border text-sm animate-in fade-in ${tone}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 [&::-webkit-details-marker]:hidden">
        {head}
        <ChevronRightIcon
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-border/60 px-3 py-2">{props.detail}</div>
    </details>
  );
}

/**
 * Role 3 — failure. What you asked for did not load.
 *
 * Rendered in the region the missing content would have occupied, and only
 * there: a page that shows both a banner and a replaced region reports one
 * failure twice. role="alert" is correct here.
 */
export function FailureBlock(props: {
  title: string;
  cause?: React.ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  /**
   * Merged onto the root. The 13rem minimum below assumes a container that can
   * scroll; a call site nested in clippers that cannot must be able to override
   * it with `min-h-0`, or the block's bottom — the Retry button — is cut off.
   */
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-[13rem] flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/25 bg-destructive/[0.035] p-8 text-center animate-in fade-in",
        props.className
      )}
    >
      <CloudOffIcon className="size-6 text-destructive/70" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{props.title}</p>
        {props.cause ? <div className="text-sm text-muted-foreground">{props.cause}</div> : null}
      </div>
      {props.onRetry ? (
        <Button variant="outline" size="sm" onClick={props.onRetry} disabled={props.retrying}>
          {props.retrying ? <Spinner className="size-3.5" /> : "Retry"}
        </Button>
      ) : null}
    </div>
  );
}

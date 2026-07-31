import { useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
} from "lucide-react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CANONICAL_HEADER,
  CANONICAL_TEMPLATE,
  NORMALISATION_PROMPT,
} from "@/ui/schedule-import/constants";
import { downloadCsv } from "@/ui/schedule-import/format";

function DropZone(props: { onFile: (file: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      role="button"
      tabIndex={props.disabled ? -1 : 0}
      aria-label="Upload schedule CSV"
      aria-disabled={props.disabled}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging
          ? "border-primary/60 bg-primary/5"
          : "border-border/60 bg-muted/20 hover:border-primary/40 hover:bg-muted/30",
        props.disabled && "pointer-events-none opacity-50"
      )}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) props.onFile(file);
      }}
    >
      <div className="flex size-11 items-center justify-center rounded-xl bg-muted/60">
        <FileSpreadsheetIcon className="size-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">Drop normalised schedule CSV here</p>
        <p className="text-xs text-muted-foreground">or click to choose a .csv / .xlsx file</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        aria-label="Upload schedule CSV file"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) props.onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function CopyPromptButton() {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(NORMALISATION_PROMPT);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard blocked (insecure context / denied permission). Tell the
          // user and point them at the doc rather than failing silently.
          toast.error("Couldn't copy automatically", {
            description: "Copy the prompt from docs/SCHEDULE_IMPORT_PROMPT.md instead.",
          });
        }
      }}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? "Copied" : "Copy AI prompt"}
    </Button>
  );
}

export function UploadStep(props: {
  onFile: (file: File) => void;
  parsing: boolean;
  parseError: string | null;
  fileName: string | null;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-5 py-6">
      {props.parseError ? (
        <p className="rounded-lg border border-destructive/25 bg-destructive/[0.035] px-3 py-2 text-sm text-destructive">
          {props.parseError}
        </p>
      ) : null}

      <DropZone onFile={props.onFile} disabled={props.parsing} />

      {props.parsing ? (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Validating {props.fileName ?? "file"}…
        </p>
      ) : null}

      <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">How to prepare this file</h2>
          <div className="flex items-center gap-2">
            <CopyPromptButton />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => downloadCsv(CANONICAL_TEMPLATE, "schedule-import-template.csv")}
            >
              <DownloadIcon className="size-3.5" />
              Template
            </Button>
          </div>
        </div>
        <ol className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>
            <strong className="text-foreground">1.</strong> Copy the AI prompt, paste your raw
            roster after <code className="rounded bg-muted px-1">SPREADSHEET:</code>, and run it in
            Claude.
          </li>
          <li>
            <strong className="text-foreground">2.</strong> Save Claude's output as a CSV — it
            already matches the canonical 7-column format.
          </li>
          <li>
            <strong className="text-foreground">3.</strong> Drop that CSV above to validate and
            review before applying.
          </li>
        </ol>
        <p className="mt-3 rounded-md bg-background/70 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
          {CANONICAL_HEADER}
        </p>
      </div>
    </div>
  );
}

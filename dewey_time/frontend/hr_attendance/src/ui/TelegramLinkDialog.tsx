/**
 * HR issues an employee's Telegram link from the SPA.
 *
 * The alternative was a bench command, which is not a workflow for a few
 * hundred employees. The action is per-employee and happens once ever, so it
 * lives as a third segment of the toolbar's existing control group rather
 * than as a new row -- /hr-attendance spent a whole plan reclaiming vertical
 * space and this must not quietly spend it back.
 *
 * The dialog shows the raw link. That IS the credential: anyone who taps it
 * before the employee does binds THEIR Telegram account to this employee. It
 * is single-use and expires, but while it is on screen it is live, and the
 * copy says so.
 */
import { useState } from "react";
import { CheckIcon, CopyIcon, SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppTooltip } from "@/ui/AppTooltip";

export type LinkInvite = { employee: string; url: string; expires_at: string };

export function TelegramLinkButton(props: { disabled?: boolean; onClick: () => void }) {
  return (
    <AppTooltip content="Issue a Telegram link" side="bottom">
      <Button
        type="button"
        variant="ghost"
        disabled={props.disabled}
        onClick={props.onClick}
        aria-label="Issue a Telegram link"
        className="h-auto min-h-14 w-11 shrink-0 rounded-none border-0 px-0 shadow-none hover:bg-muted/50"
      >
        <SendIcon className="size-4" strokeWidth={2} />
        <span className="sr-only">Telegram link</span>
      </Button>
    </AppTooltip>
  );
}

export type InviteBodyProps = {
  invite: LinkInvite | null;
  error: string | null;
  isLoading: boolean;
};

/**
 * The dialog's contents, exported separately so they can be rendered.
 *
 * Radix's DialogContent portals to the body and server-renders to null, so
 * anything reachable only through it is invisible to renderToStaticMarkup.
 * Splitting the body out is what makes the states below testable at all.
 */
export function TelegramInviteBody(props: InviteBodyProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!props.invite) return;
    await navigator.clipboard.writeText(props.invite.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
        {props.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Issuing a link…</p>
        ) : props.error ? (
          <p className="py-6 text-center text-sm text-destructive">{props.error}</p>
        ) : props.invite ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              {/* readOnly, not disabled: a disabled input cannot be selected,
                  and selecting the text by hand is the fallback when the
                  clipboard API is unavailable (it needs a secure context). */}
              <input
                readOnly
                value={props.invite.url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-foreground"
              />
              <Button type="button" variant="outline" onClick={copy} className="shrink-0">
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Expires {props.invite.expires_at}. Anyone who opens this link before
              the employee does will be bound to their record instead, so send it
              to them directly rather than to a group.
            </p>
          </div>
        ) : null}
    </>
  );
}

export function TelegramLinkDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string | null;
} & InviteBodyProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Telegram link{props.employeeName ? ` — ${props.employeeName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Send this to the employee, or let them scan it. It works once and
            expires — after that, issue a new one.
          </DialogDescription>
        </DialogHeader>
        <TelegramInviteBody
          invite={props.invite}
          error={props.error}
          isLoading={props.isLoading}
        />
      </DialogContent>
    </Dialog>
  );
}

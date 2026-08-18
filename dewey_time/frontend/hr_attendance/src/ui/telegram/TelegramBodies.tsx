/**
 * The Telegram dialog's bodies, exported one by one.
 *
 * Split from the dialog shell because Radix's DialogContent resolves its
 * portal container in a layout effect and therefore server-renders to null.
 * Under renderToStaticMarkup the whole dialog is an empty string, so every
 * assertion aimed at it passes for the wrong reason. These are portal-free.
 */
import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TelegramLinkQr } from "@/ui/telegram/TelegramLinkQr";
import { formatCountdown } from "@/ui/telegram/expiry";
import type { LinkInvite } from "@/services/telegram";
import type { TelegramLinkStatus } from "@/hooks/useTelegramLink";

/** The warning is the point of showing the raw link at all. */
const LIVE_WARNING =
  "Anyone who opens this link before the employee does will be bound to their "
  + "record instead, so send it to them directly rather than to a group.";

export function TelegramNotLinkedBody(props: {
  status: TelegramLinkStatus;
  onIssue: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        A link binds the first Telegram account that opens it to this
        employee&rsquo;s record. It works once and expires after 24 hours.
      </p>
      {/* Only for id_on_file. claim_by_recorded_id is live in the webhook, so
          these employees can already bind themselves by sending a bare /start
          — and until now nothing said so, which is how links get issued to
          people who never needed one. */}
      {props.status === "id_on_file" ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          This employee has a Telegram ID on file. They can link by opening the
          bot and sending <span className="font-mono">/start</span> — no link
          needed. Issue one only if that fails.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{LIVE_WARNING}</p>
      <Button type="button" onClick={props.onIssue} className="self-start">
        Issue link
      </Button>
    </div>
  );
}

export function TelegramInviteBody(props: {
  invite: LinkInvite;
  secondsRemaining: number | null;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(props.invite.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  // `!== null && <= 0`, not a falsy check: null means the first tick has not
  // landed yet, which is not the same as expired and must not render as it —
  // that would blank a link one moment after it was issued.
  const expired = props.secondsRemaining !== null && props.secondsRemaining <= 0;

  if (expired) {
    return (
      <div className="flex flex-col gap-3">
        <p className="py-2 text-sm text-muted-foreground">
          This link has expired. Issue a new one to send to the employee.
        </p>
        <Button type="button" onClick={props.onRegenerate} className="self-start">
          Regenerate
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <TelegramLinkQr url={props.invite.url} />
      <div className="flex items-center gap-2">
        {/* readOnly, not disabled: a disabled input cannot be selected, and
            selecting the text by hand is the fallback when the clipboard API
            is unavailable (it needs a secure context). */}
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
        {props.secondsRemaining === null
          ? "Expires in 24 hours."
          : `Expires in ${formatCountdown(props.secondsRemaining)}.`}{" "}
        {LIVE_WARNING}
      </p>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={props.onRegenerate}>
          Regenerate
        </Button>
        <span className="text-xs text-muted-foreground">
          The link above stops working.
        </span>
      </div>
    </div>
  );
}

export function TelegramLinkedBody(props: { onUnlink: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        This employee is linked to Telegram. They receive check-in messages and
        can open the Mini App.
      </p>
      <Button
        type="button"
        variant="destructive"
        onClick={props.onUnlink}
        className="self-start"
      >
        Unlink
      </Button>
    </div>
  );
}

/**
 * The confirm, in place rather than as a second dialog.
 *
 * There is no alert-dialog primitive in this design system, and stacking Radix
 * dialogs brings focus-trap problems not worth taking on for one two-button
 * question.
 */
export function TelegramUnlinkConfirm(props: {
  employeeName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">
        Unlink {props.employeeName}? They lose Mini App access and check-in
        messages until a new link is issued and opened.
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={props.onConfirm}>
          Unlink
        </Button>
      </div>
    </div>
  );
}

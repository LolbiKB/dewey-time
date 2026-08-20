/**
 * The Telegram dialog's bodies, exported one by one.
 *
 * Split from the dialog shell because Radix's DialogContent resolves its
 * portal container in a layout effect and therefore server-renders to null.
 * Under renderToStaticMarkup the whole dialog is an empty string, so every
 * assertion aimed at it passes for the wrong reason. These are portal-free.
 */
import { useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TelegramLinkQr } from "@/ui/telegram/TelegramLinkQr";
import { formatCountdown } from "@/ui/telegram/expiry";
import type { LinkInvite } from "@/services/telegram";
import type { TelegramLinkStatus } from "@/hooks/useTelegramLink";

/**
 * True when the text made it to the clipboard; false on ANY failure.
 *
 * `navigator.clipboard` is undefined outside a secure context — a bench
 * reached over plain http on a LAN address is the documented dev:hr flow —
 * and a denied permission rejects. Both used to surface as an unhandled
 * promise rejection with no feedback: the button just never flipped to
 * "Copied", and nothing pointed at the read-only input that IS the fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

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
          these employees can often bind themselves by sending a bare /start —
          and until now nothing said so, which is how links get issued to
          people who never needed one.

          The caveat is not hedging. claim_by_recorded_id deliberately refuses
          any account that already has a Telegram Link row, DISABLED included,
          so that revocation is not undone by the employee simply reopening the
          bot. After an unlink the register reports this employee as
          "ID on file" again — the link is disabled but the id is still on the
          record — so an unqualified "just send /start" would be wrong for
          exactly the people this dialog just unlinked. */}
      {props.status === "id_on_file" ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          This employee has a Telegram ID on file. Sending{" "}
          <span className="font-mono">/start</span> to the bot binds them with
          no link needed — unless they were unlinked before, which the bot
          refuses. Issue a link if that happens.
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
  const [copyFailed, setCopyFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    if (await copyToClipboard(props.invite.url)) {
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return;
    }
    // Fail loudly, and hand over the fallback in the same gesture: the
    // read-only input exists for exactly this, so select it rather than
    // describing where it is.
    setCopyFailed(true);
    inputRef.current?.focus();
    inputRef.current?.select();
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
          ref={inputRef}
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
      {copyFailed ? (
        <p role="status" className="text-xs text-muted-foreground">
          Copying is unavailable in this browser, so the link text is selected
          above — copy it by hand.
        </p>
      ) : null}
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

/**
 * A failure, with the way back out of it.
 *
 * This used to be a bare paragraph the dialog rendered INSTEAD of everything
 * else -- no retry, no dismiss, and a still-live link gone from view until
 * the dialog was closed and reopened. An error is a message, not a
 * destination: dismissing it returns to the state underneath, from which
 * Issue or Unlink can simply be pressed again.
 */
export function TelegramErrorBody(props: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="py-2 text-sm text-destructive">
        {props.message}
      </p>
      <Button type="button" variant="outline" onClick={props.onDismiss} className="self-start">
        Dismiss
      </Button>
    </div>
  );
}

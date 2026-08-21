/**
 * The one place the Telegram link lifecycle is operated.
 *
 * Opening it mints nothing. The row button used to issue a live credential on
 * a single stray click, with no confirmation anywhere — this dialog is where
 * that became a deliberate act.
 */
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TelegramErrorBody,
  TelegramInviteBody,
  TelegramLinkedBody,
  TelegramNotLinkedBody,
  TelegramUnlinkConfirm,
} from "@/ui/telegram/TelegramBodies";
import type { TelegramLink } from "@/hooks/useTelegramLink";

export function TelegramDialog(props: { link: TelegramLink }) {
  const { target, invite, error, busy, close, issue, revoke, dismissError } = props.link;
  const open = target !== null;

  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  // The deadline is pinned ONCE, from the duration the server sent, at the
  // moment the invite lands. Deriving it during render would restart the clock
  // on every unrelated re-render.
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  useEffect(() => {
    if (!invite) {
      setDeadlineMs(null);
      setSecondsRemaining(null);
      return;
    }
    setDeadlineMs(Date.now() + invite.expires_in_seconds * 1000);
  }, [invite]);

  // Gated on `open`, and torn down on close, on a new deadline, and on
  // reaching zero. An interval left running behind a closed dialog is the
  // mirror of the Mini App's clock frozen at mount — same class of mistake,
  // and this one keeps a timer alive for the life of the page.
  useEffect(() => {
    if (!open || deadlineMs === null) return;
    let id = 0;
    const tick = () => {
      const left = Math.max(0, Math.round((deadlineMs - Date.now()) / 1000));
      setSecondsRemaining(left);
      if (left <= 0) window.clearInterval(id);
    };
    tick();
    id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, deadlineMs]);

  // The confirm is transient UI, not state worth surviving a close. Without
  // this, reopening for the next employee lands straight on "Unlink <name>?".
  useEffect(() => {
    if (!open) setConfirmingUnlink(false);
  }, [open]);

  function body() {
    if (!target) return null;
    if (error) {
      // A message, not a destination: Dismiss returns to the state
      // underneath, from which Issue or Unlink can simply be pressed again.
      return <TelegramErrorBody message={error} onDismiss={dismissError} />;
    }
    if (busy === "issuing") {
      return <p className="py-6 text-center text-sm text-muted-foreground">Issuing a link…</p>;
    }
    if (busy === "revoking") {
      return <p className="py-6 text-center text-sm text-muted-foreground">Unlinking…</p>;
    }
    if (invite) {
      return (
        <TelegramInviteBody
          invite={invite}
          secondsRemaining={secondsRemaining}
          onRegenerate={issue}
        />
      );
    }
    if (confirmingUnlink) {
      return (
        <TelegramUnlinkConfirm
          employeeName={target.employeeName}
          onCancel={() => setConfirmingUnlink(false)}
          onConfirm={() => {
            setConfirmingUnlink(false);
            revoke();
          }}
        />
      );
    }
    if (target.status === "linked") {
      return <TelegramLinkedBody onUnlink={() => setConfirmingUnlink(true)} />;
    }
    return <TelegramNotLinkedBody status={target.status} onIssue={issue} />;
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Telegram{target ? ` — ${target.employeeName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Send the link to the employee, or let them scan it. It works once
            and expires after 24 hours.
          </DialogDescription>
        </DialogHeader>
        {body()}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Which employee the Telegram dialog is open for, and what it is doing.
 *
 * Replaces `useTelegramInvite`, which was shared because two surfaces issued
 * the same credential. Only the coverage register does now, so this is not a
 * shared hook -- it is that page's dialog state, and it covers the whole
 * lifecycle rather than just the issuing half.
 */
import { useCallback, useState } from "react";

import { createLinkInvite, revokeLink, type LinkInvite } from "@/services/telegram";

export type { LinkInvite };

export type TelegramLinkStatus = "linked" | "id_on_file" | "none";

export type TelegramTarget = {
  employee: string;
  employeeName: string;
  status: TelegramLinkStatus;
};

export type TelegramLink = {
  target: TelegramTarget | null;
  invite: LinkInvite | null;
  error: string | null;
  busy: "issuing" | "revoking" | null;
  openFor: (target: TelegramTarget) => void;
  close: () => void;
  issue: () => void;
  revoke: () => void;
};

export function useTelegramLink(opts?: { onUnlinked?: () => void }): TelegramLink {
  const [target, setTarget] = useState<TelegramTarget | null>(null);
  const [invite, setInvite] = useState<LinkInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"issuing" | "revoking" | null>(null);

  // Reset FIRST, before anything awaits. Leaving the previous employee's link
  // on screen while the next one loads is how someone sends the wrong person a
  // credential that binds their Telegram account to the wrong record.
  const openFor = useCallback((next: TelegramTarget) => {
    setInvite(null);
    setError(null);
    setBusy(null);
    setTarget(next);
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    setInvite(null);
    setError(null);
    setBusy(null);
  }, []);

  const issue = useCallback(() => {
    if (!target) return;
    const employee = target.employee;
    setInvite(null);
    setError(null);
    setBusy("issuing");
    void (async () => {
      try {
        setInvite(await createLinkInvite(employee));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not issue a link");
      } finally {
        setBusy(null);
      }
    })();
  }, [target]);

  const revoke = useCallback(() => {
    if (!target) return;
    const employee = target.employee;
    setError(null);
    setBusy("revoking");
    void (async () => {
      try {
        await revokeLink(employee);
        // Locally, not by refetching: the dialog must show the unlinked state
        // immediately, and the feed refresh the caller does is a network round
        // trip the person standing at the screen should not wait through.
        //
        // Guarded on the id because the dialog can be reopened for someone
        // else while this is in flight, and writing "none" onto THEIR row
        // would offer Issue for an employee who is still linked.
        setTarget((current) =>
          current && current.employee === employee
            ? { ...current, status: "none" }
            : current,
        );
        opts?.onUnlinked?.();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not unlink");
      } finally {
        setBusy(null);
      }
    })();
  }, [target, opts]);

  return { target, invite, error, busy, openFor, close, issue, revoke };
}

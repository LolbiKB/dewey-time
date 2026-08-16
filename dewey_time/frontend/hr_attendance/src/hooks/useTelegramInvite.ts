/**
 * Issuing a Telegram link, for the two surfaces that do it.
 *
 * The toolbar issues one for the employee already on screen; the coverage
 * register issues one from any row. Both need the same four pieces of state
 * and the same reset-before-fetch rule, and the toolbar's original hand-rolled
 * copy read `_server_messages` raw — a JSON-encoded ARRAY, so a server-side
 * frappe.throw() reached the reader as `["{\"message\": \"Not permitted\"}"]`.
 * Routing through frappeCall is what makes the message legible.
 */
import { useCallback, useState } from "react";

import { createLinkInvite, type LinkInvite } from "@/services/telegram";

export type { LinkInvite };

export type TelegramInvite = {
  open: boolean;
  setOpen: (open: boolean) => void;
  invite: LinkInvite | null;
  error: string | null;
  isLoading: boolean;
  /** Opens the dialog and issues a link for `employee`. */
  issue: (employee: string) => void;
};

export function useTelegramInvite(): TelegramInvite {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<LinkInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const issue = useCallback((employee: string) => {
    // Reset FIRST, before the await. Leaving the previous employee's link on
    // screen while the next one loads is how someone sends the wrong person a
    // credential that binds their Telegram account to the wrong record.
    setInvite(null);
    setError(null);
    setIsLoading(true);
    setOpen(true);

    void (async () => {
      try {
        setInvite(await createLinkInvite(employee));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not issue a link");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return { open, setOpen, invite, error, isLoading, issue };
}

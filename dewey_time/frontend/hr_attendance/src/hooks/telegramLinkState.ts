/**
 * The Telegram dialog's state machine, pure and generation-guarded.
 *
 * Extracted from `useTelegramLink` because the defect it exists to prevent is
 * about WHICH async results get applied, and that logic must be testable
 * without a DOM. Every open/close bumps `gen`; every network operation
 * captures the gen it started under and its settlement carries it back. A
 * settlement whose gen is stale changes NOTHING — not the invite, not the
 * error, not the spinner.
 *
 * The failure this closes: HR pressed Issue for employee A on a slow link,
 * closed the dialog, opened employee B — and A's response then painted A's
 * live credential (QR, countdown, copyable URL) under B's name. `revoke`
 * carried a hand-rolled guard against exactly this; `issue`, `error` and
 * `busy` did not. One mechanism now covers all of them.
 */
import type { LinkInvite } from "@/services/telegram";

export type TelegramLinkStatus = "linked" | "id_on_file" | "none";

export type TelegramTarget = {
  employee: string;
  employeeName: string;
  status: TelegramLinkStatus;
};

export type LinkState = {
  /** Bumped on every open/close. The staleness test for every settlement. */
  gen: number;
  target: TelegramTarget | null;
  invite: LinkInvite | null;
  error: string | null;
  busy: "issuing" | "revoking" | null;
};

export const INITIAL_LINK_STATE: LinkState = {
  gen: 0,
  target: null,
  invite: null,
  error: null,
  busy: null,
};

export type LinkAction =
  | { type: "open"; target: TelegramTarget }
  | { type: "close" }
  | { type: "issueStart" }
  | { type: "issued"; gen: number; invite: LinkInvite }
  | { type: "revokeStart" }
  | { type: "revoked"; gen: number }
  | { type: "failed"; gen: number; message: string }
  | { type: "dismissError" };

export function linkReducer(state: LinkState, action: LinkAction): LinkState {
  switch (action.type) {
    // Reset FIRST, atomically with the target swap. Leaving the previous
    // employee's link on screen while the next one loads is how someone sends
    // the wrong person a credential.
    case "open":
      return { gen: state.gen + 1, target: action.target, invite: null, error: null, busy: null };
    case "close":
      return { gen: state.gen + 1, target: null, invite: null, error: null, busy: null };
    case "issueStart":
      return { ...state, invite: null, error: null, busy: "issuing" };
    case "revokeStart":
      return { ...state, error: null, busy: "revoking" };
    case "issued":
      if (action.gen !== state.gen) return state;
      return { ...state, invite: action.invite, busy: null };
    case "revoked":
      if (action.gen !== state.gen) return state;
      // Locally, not by refetching: the dialog must show the unlinked state
      // immediately. The gen match already proves this is the same target the
      // revoke was pressed for.
      return {
        ...state,
        target: state.target ? { ...state.target, status: "none" } : null,
        busy: null,
      };
    case "failed":
      if (action.gen !== state.gen) return state;
      return { ...state, error: action.message, busy: null };
    // Deliberately NOT a gen bump: the error belongs to this dialog view, and
    // dismissing it returns to the state underneath — from which Issue or
    // Unlink can simply be pressed again.
    case "dismissError":
      return { ...state, error: null };
  }
}

/**
 * Which employee the Telegram dialog is open for, and what it is doing.
 *
 * Replaces `useTelegramInvite`, which was shared because two surfaces issued
 * the same credential. Only the coverage register does now, so this is not a
 * shared hook -- it is that page's dialog state, and it covers the whole
 * lifecycle rather than just the issuing half.
 *
 * The state itself lives in `telegramLinkState.ts` as a pure reducer, and the
 * reason is the defect that reducer's docstring records: a settlement from a
 * previous target must change nothing, and "nothing" has to cover invite,
 * error AND busy at once. This file only starts the network calls and hands
 * their results back with the generation they started under.
 */
import { useCallback, useReducer, useRef } from "react";

import { createLinkInvite, revokeLink, type LinkInvite } from "@/services/telegram";
import {
  INITIAL_LINK_STATE,
  linkReducer,
  type TelegramLinkStatus,
  type TelegramTarget,
} from "@/hooks/telegramLinkState";

export type { LinkInvite, TelegramLinkStatus, TelegramTarget };

export type TelegramLink = {
  target: TelegramTarget | null;
  invite: LinkInvite | null;
  error: string | null;
  busy: "issuing" | "revoking" | null;
  openFor: (target: TelegramTarget) => void;
  close: () => void;
  issue: () => void;
  revoke: () => void;
  dismissError: () => void;
};

export function useTelegramLink(opts?: { onUnlinked?: () => void }): TelegramLink {
  const [state, dispatch] = useReducer(linkReducer, INITIAL_LINK_STATE);

  // The gen and target an operation captures must be the ones on screen when
  // the button was pressed. A ref rather than a closure over `state`: the
  // callbacks are stable, and reading a stale render's state would defeat the
  // guard from the other side.
  const stateRef = useRef(state);
  stateRef.current = state;

  const openFor = useCallback((next: TelegramTarget) => {
    dispatch({ type: "open", target: next });
  }, []);

  const close = useCallback(() => {
    dispatch({ type: "close" });
  }, []);

  const dismissError = useCallback(() => {
    dispatch({ type: "dismissError" });
  }, []);

  const issue = useCallback(() => {
    const current = stateRef.current;
    if (!current.target) return;
    const { gen } = current;
    const employee = current.target.employee;
    dispatch({ type: "issueStart" });
    void (async () => {
      try {
        // A dropped stale invite is safe server-side: minting revokes every
        // outstanding token for the employee, so the credential this discards
        // dies the moment a fresh one is issued.
        dispatch({ type: "issued", gen, invite: await createLinkInvite(employee) });
      } catch (caught) {
        dispatch({
          type: "failed",
          gen,
          message: caught instanceof Error ? caught.message : "Could not issue a link",
        });
      }
    })();
  }, []);

  const revoke = useCallback(() => {
    const current = stateRef.current;
    if (!current.target) return;
    const { gen } = current;
    const employee = current.target.employee;
    dispatch({ type: "revokeStart" });
    void (async () => {
      try {
        await revokeLink(employee);
        dispatch({ type: "revoked", gen });
        // Unconditionally, even if the dialog has moved on: the revoke DID
        // happen, and the caller's refetch is how the register row it
        // belonged to stops offering Unlink.
        opts?.onUnlinked?.();
      } catch (caught) {
        dispatch({
          type: "failed",
          gen,
          message: caught instanceof Error ? caught.message : "Could not unlink",
        });
      }
    })();
  }, [opts]);

  return {
    target: state.target,
    invite: state.invite,
    error: state.error,
    busy: state.busy,
    openFor,
    close,
    issue,
    revoke,
    dismissError,
  };
}

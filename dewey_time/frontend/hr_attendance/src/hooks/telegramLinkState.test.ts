import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_LINK_STATE,
  linkReducer,
  type LinkState,
  type TelegramTarget,
} from "@/hooks/telegramLinkState";

const A: TelegramTarget = { employee: "HR-EMP-00001", employeeName: "Sokha", status: "none" };
const B: TelegramTarget = { employee: "HR-EMP-00002", employeeName: "Dara", status: "linked" };

const INVITE = {
  employee: "HR-EMP-00001",
  url: "https://t.me/dewey_time_bot?start=tokA",
  expires_at: "2026-08-21 09:00:00",
  expires_in_seconds: 86_400,
};

function issuingFor(target: TelegramTarget): LinkState {
  const opened = linkReducer(INITIAL_LINK_STATE, { type: "open", target });
  return linkReducer(opened, { type: "issueStart" });
}

test("a late invite for the previous employee never reaches the next one's dialog", () => {
  // THE defect this reducer exists to prevent: HR issues for A on a slow
  // link, closes, opens B — and A's response used to paint A's live
  // credential (QR, countdown, copyable URL) under B's name. The obvious next
  // act hands A's record to B's Telegram account.
  const issuingA = issuingFor(A);
  const genA = issuingA.gen;
  const closed = linkReducer(issuingA, { type: "close" });
  const onB = linkReducer(closed, { type: "open", target: B });

  const settled = linkReducer(onB, { type: "issued", gen: genA, invite: INVITE });

  assert.equal(settled.invite, null);
  assert.equal(settled.target, B);
});

test("a late failure does not paint an error into a dialog it never belonged to", () => {
  const issuingA = issuingFor(A);
  const genA = issuingA.gen;
  const onB = linkReducer(linkReducer(issuingA, { type: "close" }), { type: "open", target: B });

  const settled = linkReducer(onB, { type: "failed", gen: genA, message: "Could not issue a link" });

  assert.equal(settled.error, null);
});

test("a stale settlement cannot clear the next operation's spinner", () => {
  // The (b) ordering from the review: A's unlink is in flight, HR opens B and
  // presses Issue. A's settlement must not blank B's "Issuing…" state — under
  // the old shared `busy`, A's `finally` cleared it mid-flight and the dialog
  // fell back to a body with live buttons while B's request was still out.
  const revokingA = linkReducer(linkReducer(INITIAL_LINK_STATE, { type: "open", target: A }), {
    type: "revokeStart",
  });
  const genA = revokingA.gen;
  const issuingB = linkReducer(
    linkReducer(linkReducer(revokingA, { type: "close" }), { type: "open", target: B }),
    { type: "issueStart" },
  );

  const settled = linkReducer(issuingB, { type: "revoked", gen: genA });

  assert.equal(settled.busy, "issuing");
  assert.equal(settled.target?.status, "linked");
});

test("a current settlement still lands", () => {
  // The guard must reject STALENESS, not settlements as such — a reducer that
  // dropped everything would pass the three tests above.
  const issuingA = issuingFor(A);
  const settled = linkReducer(issuingA, { type: "issued", gen: issuingA.gen, invite: INVITE });
  assert.equal(settled.invite, INVITE);
  assert.equal(settled.busy, null);
});

test("a current revoke flips this target's status locally", () => {
  const revoking = linkReducer(linkReducer(INITIAL_LINK_STATE, { type: "open", target: B }), {
    type: "revokeStart",
  });
  const settled = linkReducer(revoking, { type: "revoked", gen: revoking.gen });
  assert.equal(settled.target?.status, "none");
  assert.equal(settled.busy, null);
});

test("reopening for the same employee is still a new generation", () => {
  // Same person, closed and reopened: the in-flight invite from the first
  // opening must be dropped too. Its token dies the moment Issue is pressed
  // again (minting revokes outstanding), so showing it would display a
  // credential one further click kills.
  const issuingA = issuingFor(A);
  const genFirst = issuingA.gen;
  const reopened = linkReducer(linkReducer(issuingA, { type: "close" }), {
    type: "open",
    target: A,
  });

  const settled = linkReducer(reopened, { type: "issued", gen: genFirst, invite: INVITE });

  assert.equal(settled.invite, null);
});

test("dismissing an error keeps everything else, including the target", () => {
  const issuingA = issuingFor(A);
  const failed = linkReducer(issuingA, {
    type: "failed",
    gen: issuingA.gen,
    message: "Could not issue a link",
  });
  const dismissed = linkReducer(failed, { type: "dismissError" });

  assert.equal(dismissed.error, null);
  assert.equal(dismissed.target, A);
  assert.equal(dismissed.gen, failed.gen);
});

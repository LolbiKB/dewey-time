import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TelegramInviteBody,
  TelegramLinkedBody,
  TelegramNotLinkedBody,
  TelegramUnlinkConfirm,
} from "@/ui/telegram/TelegramBodies";

// These bodies are exported one by one, and the tests point at them rather
// than at TelegramDialog, because Radix's DialogContent resolves its portal
// container in a layout effect and server-renders to null. Under
// renderToStaticMarkup the whole dialog is an empty string, so every assertion
// aimed at it would pass for the wrong reason.

const INVITE = {
  employee: "HR-EMP-00001",
  url: "https://t.me/dewey_time_bot?start=Xk3_9pQ-rT7wLmZ2aB4cD6eF8gH0iJkL",
  expires_at: "2026-08-19 09:00:00",
  expires_in_seconds: 86_400,
};

const noop = () => {};

test("the link input is readOnly rather than disabled, so it stays selectable", () => {
  // navigator.clipboard needs a secure context. When it is unavailable,
  // selecting the text by hand is the only fallback — and a disabled input
  // cannot be selected.
  const html = renderToStaticMarkup(
    <TelegramInviteBody invite={INVITE} secondsRemaining={86_400} onRegenerate={noop} />,
  );
  assert.match(html, /readonly=""/i);
  assert.doesNotMatch(html, /<input[^>]*\sdisabled=""/);
  assert.match(html, /t\.me\/dewey_time_bot/);
});

test("the issued body warns that the link is live, and shows the time left", () => {
  // It is a credential on screen: whoever opens it first gets bound to this
  // employee's record. HR should not have to infer that.
  const html = renderToStaticMarkup(
    <TelegramInviteBody invite={INVITE} secondsRemaining={86_400} onRegenerate={noop} />,
  );
  assert.match(html, /bound to their record instead/);
  assert.match(html, /24h 0m/);
});

test("before the first tick the link shows, and no countdown is invented", () => {
  // null is "the interval has not fired yet", which is NOT expired. Rendering
  // it as expired would blank a link that was just issued.
  const html = renderToStaticMarkup(
    <TelegramInviteBody invite={INVITE} secondsRemaining={null} onRegenerate={noop} />,
  );
  assert.match(html, /t\.me\/dewey_time_bot/);
  assert.doesNotMatch(html, /Expired/);
});

test("an expired link shows neither the URL nor the QR", () => {
  // THE state a static "Expires 2026-08-19 09:00:00" can never reach. A dead
  // credential that still renders as a live one is worse than no display at
  // all: HR sends it, and the employee gets a link that silently fails.
  const html = renderToStaticMarkup(
    <TelegramInviteBody invite={INVITE} secondsRemaining={0} onRegenerate={noop} />,
  );
  assert.doesNotMatch(html, /t\.me/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /expired/i);
});

test("an id on file is reported as already bindable without a link", () => {
  // claim_by_recorded_id is live in the webhook today: a bare /start binds
  // these employees. Nothing currently tells HR, so they issue links people
  // do not need.
  const html = renderToStaticMarkup(
    <TelegramNotLinkedBody status="id_on_file" onIssue={noop} />,
  );
  assert.match(html, /\/start/);
});

test("an employee with nothing on file is not told to try /start", () => {
  // The mirror. Telling them to open the bot would send them to a refusal.
  const html = renderToStaticMarkup(
    <TelegramNotLinkedBody status="none" onIssue={noop} />,
  );
  assert.doesNotMatch(html, /\/start/);
});

test("a linked employee is offered Unlink and never Issue", () => {
  // Issuing for someone already bound is refused by the API; offering it here
  // would be an error message dressed as a button.
  const html = renderToStaticMarkup(<TelegramLinkedBody onUnlink={noop} />);
  assert.match(html, /Unlink/);
  assert.doesNotMatch(html, /Issue link/);
});

test("the unlink confirm names the employee and states what is lost", () => {
  const html = renderToStaticMarkup(
    <TelegramUnlinkConfirm employeeName="Aaron Wells" onCancel={noop} onConfirm={noop} />,
  );
  assert.match(html, /Aaron Wells/);
  assert.match(html, /Mini App/);
});

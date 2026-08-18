import assert from "node:assert/strict";
import type React from "react";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "@/components/ui/tooltip";

import { TelegramInviteBody, TelegramLinkButton } from "@/ui/TelegramLinkDialog";

// TelegramInviteBody, not TelegramLinkDialog: Radix's DialogContent portals to
// the body and server-renders to null, so asserting against the dialog itself
// only ever inspects an empty string — every assertion below would pass for
// the wrong reason.

/** The button is wrapped in AppTooltip, and Radix throws "`Tooltip` must be
 *  used within `TooltipProvider`" outside a provider. The HR entry supplies
 *  one at the root, so this mirrors production rather than working around it
 *  — the same omission crashed the Mini App's Week tab. */
function renderButton(node: React.ReactElement) {
  return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
}

const INVITE = {
  employee: "HR-EMP-00001",
  url: "https://t.me/dewey_time_bot?start=Xk3_9pQ-rT7wLmZ2aB4cD6eF8gH0iJkL",
  expires_at: "2026-08-23 09:00:00",
  // Required by LinkInvite as of the lifecycle work. This whole file is
  // superseded by src/ui/telegram/telegramBodies.test.tsx and deleted there;
  // this keeps the tree typechecking in the meantime.
  expires_in_seconds: 86_400,
};

test("the trigger is disabled until an employee is selected", () => {
  // Issuing a link needs a subject. Enabled with none selected, the click
  // either errors or — worse — issues one for whoever was selected last.
  const html = renderButton(<TelegramLinkButton disabled onClick={() => {}} />);
  assert.match(html, /<button[^>]*\sdisabled=""/);
});

test("the trigger is an icon button with a real accessible name", () => {
  // Icon-only, so without aria-label it announces as "button".
  const html = renderButton(<TelegramLinkButton onClick={() => {}} />);
  assert.match(html, /aria-label="Issue a Telegram link"/);
});

test("a loading dialog shows no stale link from the previous employee", () => {
  // The dangerous state. Leaving the last employee's link on screen while the
  // next one loads is exactly how someone sends the wrong person's
  // credential, and it would look completely normal.
  const html = renderToStaticMarkup(
    <TelegramInviteBody
      invite={null}
      error={null}
      isLoading
    />,
  );
  assert.doesNotMatch(html, /t\.me/);
  assert.match(html, /Issuing a link/);
});

test("an error is shown instead of a link, never alongside one", () => {
  const html = renderToStaticMarkup(
    <TelegramInviteBody
      invite={null}
      error="Not permitted"
      isLoading={false}
    />,
  );
  assert.match(html, /Not permitted/);
  assert.doesNotMatch(html, /t\.me/);
});

test("the link is readOnly rather than disabled, so it stays selectable", () => {
  // navigator.clipboard needs a secure context. When it is unavailable,
  // selecting the text by hand is the only fallback — and a disabled input
  // cannot be selected.
  const html = renderToStaticMarkup(
    <TelegramInviteBody
      invite={INVITE}
      error={null}
      isLoading={false}
    />,
  );
  assert.match(html, /readonly=""/i);
  assert.doesNotMatch(html, /<input[^>]*\sdisabled=""/);
  assert.match(html, /t\.me\/dewey_time_bot/);
});

test("the dialog warns that the link is live, and names the expiry", () => {
  // It is a credential on screen: whoever opens it first gets bound to this
  // employee's record. HR should not have to infer that.
  const html = renderToStaticMarkup(
    <TelegramInviteBody
      invite={INVITE}
      error={null}
      isLoading={false}
    />,
  );
  assert.match(html, /2026-08-23/);
  assert.match(html, /bound to their record instead/);
});

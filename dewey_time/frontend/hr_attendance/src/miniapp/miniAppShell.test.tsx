import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MiniIdentity, initialsOf, subtitleOf } from "@/miniapp/MiniIdentity";

import { MiniTabBar, OutsideTelegramNotice } from "@/miniapp/MiniAppShell";

test("outside Telegram the app explains itself instead of erroring", () => {
  const html = renderToStaticMarkup(<OutsideTelegramNotice />);
  assert.match(html, /Telegram/);
});

test("the shell offers exactly the three employee views", () => {
  // Not the HR console with things hidden — a different surface that happens
  // to share components. An HR tab appearing here is a scope failure, not a
  // styling one.
  const html = renderToStaticMarkup(<MiniTabBar active="day" onSelect={() => {}} />);
  for (const label of ["Today", "Week", "Schedule"]) {
    assert.match(html, new RegExp(label));
  }
  for (const forbidden of ["Flags", "Coverage", "Import", "Biometric"]) {
    assert.doesNotMatch(html, new RegExp(forbidden));
  }
});

test("the active tab is marked for assistive tech, not only coloured", () => {
  const html = renderToStaticMarkup(<MiniTabBar active="week" onSelect={() => {}} />);
  assert.match(html, /aria-current="page"[^>]*>|aria-current="page"/);
});

test("the tab bar renders without a window, and pads when told to", () => {
  // It used to read `window` during render, which is unrenderable anywhere
  // without one. The safe-area value is the shell's to fetch and pass down.
  const bare = renderToStaticMarkup(<MiniTabBar active="day" onSelect={() => {}} />);
  assert.match(bare, /padding-bottom:\s*0/);

  const padded = renderToStaticMarkup(
    <MiniTabBar active="day" onSelect={() => {}} insetBottom={34} />,
  );
  assert.match(padded, /padding-bottom:\s*34px/);
});

// ---------------------------------------------------------------------------
// The identity header
// ---------------------------------------------------------------------------

test("the header shows the record the SERVER resolved, not the Telegram profile", () => {
  // The whole point is confirmation. Telegram already knows the viewer's own
  // name and echoing it back proves nothing; what an employee cannot otherwise
  // check is WHICH Employee record their account is bound to — the risk the
  // recorded-id bind path introduced.
  const html = renderToStaticMarkup(
    <MiniIdentity
      employee="HR-EMP-00042"
      employeeName="Sok Dara"
      khmerName="សុខ ដារា"
      designation="Cashier"
      branch="DIS Iconic"
      photoUrl={null}
    />,
  );
  assert.match(html, /Sok Dara/);
  assert.match(html, /សុខ ដារា/);
  assert.match(html, /HR-EMP-00042/);
  assert.match(html, /Cashier · DIS Iconic/);
});

test("a Telegram avatar is decoration, and announces nothing", () => {
  // It comes from initDataUnsafe, which is explicitly untrusted. The name
  // beside it is the server's, so an announced photo would be the same fact
  // twice — and a trusted-looking one at that.
  const html = renderToStaticMarkup(
    <MiniIdentity
      employee="HR-EMP-00042" employeeName="Sok Dara" khmerName={null}
      designation={null} branch={null} photoUrl="https://t.me/i/a.jpg"
    />,
  );
  assert.match(html, /alt=""/);
  assert.match(html, /aria-hidden="true"/);
});

test("initials fall back to the employee id when there is no name", () => {
  assert.equal(initialsOf("Sok Dara", "HR-EMP-00042"), "SD");
  assert.equal(initialsOf("Madonna", "HR-EMP-00042"), "MA");
  // An employee id has no initials worth taking; its last two characters at
  // least differ between people.
  assert.equal(initialsOf(null, "HR-EMP-00042"), "42");
  assert.equal(initialsOf("", undefined), "??");
});

test("the subtitle composes only what exists", () => {
  // A great many employees have no branch, and separators around nothing look
  // like a rendering fault.
  assert.equal(subtitleOf("Cashier", "DIS Iconic"), "Cashier · DIS Iconic");
  assert.equal(subtitleOf("Cashier", null), "Cashier");
  assert.equal(subtitleOf(null, "DIS Iconic"), "DIS Iconic");
  assert.equal(subtitleOf(null, null), null);
  assert.equal(subtitleOf("  ", ""), null);
});

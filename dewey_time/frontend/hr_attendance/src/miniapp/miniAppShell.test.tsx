import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MiniIdentity, initialsOf, subtitleOf } from "@/miniapp/MiniIdentity";
import { MiniLocaleProvider } from "@/miniapp/MiniLocale";

import {
  isMiniTab, MiniTabBar, OutsideTelegramNotice, TAB_BAR_FLOOR_PX,
} from "@/miniapp/MiniAppShell";

test("outside Telegram the app explains itself instead of erroring", () => {
  const html = renderToStaticMarkup(<OutsideTelegramNotice />);
  assert.match(html, /Telegram/);
});

test("the shell offers exactly the two employee views", () => {
  // Not the HR console with things hidden — a different surface that happens
  // to share components. An HR tab appearing here is a scope failure, not a
  // styling one, and that half of this test is the load-bearing half.
  //
  // Two, not three. "Week" was the first casualty — the calendar sheet answers
  // "which day do I want?" at four times the density from inside Today.
  // "Schedule" was the second: it answered one question about an employee's own
  // record, and Profile answers the rest while keeping that roster whole at the
  // bottom of itself.
  const html = renderToStaticMarkup(<MiniTabBar active="day" onSelect={() => {}} />);
  for (const label of ["Today", "Profile"]) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /Week/);
  assert.doesNotMatch(html, /Schedule/);
  for (const forbidden of ["Flags", "Coverage", "Import", "Biometric"]) {
    assert.doesNotMatch(html, new RegExp(forbidden));
  }
});

test("the active tab is marked for assistive tech, not only coloured", () => {
  const html = renderToStaticMarkup(<MiniTabBar active="profile" onSelect={() => {}} />);
  assert.match(html, /aria-current="page"[^>]*>|aria-current="page"/);
});

test("a tab key from a previous version is rejected rather than trusted", () => {
  // Someone whose last session ended on Schedule has "schedule" in
  // CloudStorage. The guard IS the migration: an unknown value is refused and
  // the shell falls back to Today. This is the second time it has done that
  // job — "week" went the same way when the calendar sheet replaced it.
  assert.equal(isMiniTab("day"), true);
  assert.equal(isMiniTab("profile"), true);
  assert.equal(isMiniTab("schedule"), false);
  assert.equal(isMiniTab("week"), false);
});

test("the tab bar renders without a window, and pads when told to", () => {
  // It used to read `window` during render, which is unrenderable anywhere
  // without one. The safe-area value is the shell's to fetch and pass down.
  const bare = renderToStaticMarkup(<MiniTabBar active="day" onSelect={() => {}} />);
  assert.match(bare, new RegExp(`padding-bottom:\\s*${TAB_BAR_FLOOR_PX}px`));

  const padded = renderToStaticMarkup(
    <MiniTabBar active="day" onSelect={() => {}} insetBottom={34} />,
  );
  assert.match(padded, new RegExp(`padding-bottom:\\s*${34 + TAB_BAR_FLOOR_PX}px`));
});

test("the inset is added to the floor, not chosen between", () => {
  // The safe-area inset is exactly the strip the home indicator occupies — a
  // clearance, not a margin. Taking the larger of the two would mean a 34px
  // notch swallows the gap entirely and the labels sit on the hardware, which
  // is the state this floor exists to prevent.
  const padded = renderToStaticMarkup(
    <MiniTabBar active="day" onSelect={() => {}} insetBottom={34} />,
  );
  assert.doesNotMatch(padded, /padding-bottom:\s*34px/);
});

test("nothing sits between the content and the tab bar", () => {
  // The "add to your home screen" row lived here: permanent chrome on the
  // shortest axis this app has, offering a one-time action. Telegram's
  // checkHomeScreenStatus frequently answers "unknown", and the row treated
  // that as offerable — so people who had already added the icon were asked
  // again on every launch.
  //
  // A source read, not a render: the row was conditional on async state that
  // never resolves under renderToStaticMarkup, so a rendered snapshot would
  // have been clean the whole time it was shipping.
  const shell = readFileSync(new URL("./MiniAppShell.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(shell, /addToHomeScreen|homeScreenStatus|to your home screen/);
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

test("the shell's todayKey follows the ticking clock, not the render's", () => {
  // #200 gave MyDayPage a minute tick precisely because a poll returning
  // identical data never re-renders — so a render-time `new Date()` froze the
  // date past midnight. The shell's identity query had the same defect: after
  // midnight it kept polling yesterday's one-day range while the Day tab had
  // moved on, doubling the calendar traffic until the app was reopened. A
  // source pin, because the shell's clock cannot be driven from node:test.
  const source = readFileSync(
    new URL("./MiniAppShell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /const tick = useMinuteTick\(\);/);
  assert.match(source, /const todayKey = format\(tick, "yyyy-MM-dd"\)/);
  assert.doesNotMatch(source, /format\(new Date\(\), "yyyy-MM-dd"\)/);
});

test("under Khmer the header's landmark announces in Khmer", () => {
  // The banner exists to catch a mis-binding, and it named itself "Your
  // record" in English on a Khmer phone — with the translation sitting in the
  // table, written, with no call site. This is the assertion that failed.
  const html = renderToStaticMarkup(
    <MiniLocaleProvider locale="km">
      <MiniIdentity
        employee="HR-EMP-00042" employeeName={null} khmerName="សុខ ដារា"
        designation={null} branch={null} photoUrl={null}
      />
    </MiniLocaleProvider>,
  );
  assert.match(html, /aria-label="កំណត់ត្រារបស់អ្នក"/);
  assert.ok(!/Your record/.test(html), "no English name on a Khmer screen");
});

test("the English literal cannot come back", () => {
  // A source guard, because the render above only proves the Khmer path: a
  // future edit could reintroduce the literal on the fallback branch and every
  // rendered assertion here would stay green.
  const code = readFileSync(new URL("./MiniIdentity.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/"Your record"/.test(code), "the header's words come from the table");
});

test("the two values that verify a binding are the last to give, not the first", () => {
  // A STRUCTURAL pin, not a layout claim — the widths were measured in a
  // browser at 320px and that measurement cannot live in node:test. What is
  // pinned here is the arrangement that made it true: the Latin name is the
  // element that truncates, and the employee id is the one that refuses to
  // shrink. Both were the other way round, inside a single truncating line.
  const html = renderToStaticMarkup(
    <MiniIdentity
      employee="HR-EMP-00042" employeeName="Sok Dara Sophaline Chanthavy"
      khmerName="សុខ ដារា" designation="Cashier" branch="DIS Iconic"
      photoUrl={null}
    />,
  );
  const idSpan = html.match(/<span[^>]*>HR-EMP-00042<\/span>/)?.[0] ?? "";
  assert.match(idSpan, /shrink-0/, "the employee id must not be the first thing lost");
  const khmerSpan = html.match(/<span[^>]*>សុខ ដារា<\/span>/)?.[0] ?? "";
  assert.match(khmerSpan, /shrink-0/, "nor the Khmer name");
  // And the Khmer name is no longer a tail on the Latin name's line, where a
  // long transliteration pushed it off the edge before it could be read.
  assert.ok(
    !/Sok Dara Sophaline Chanthavy[^<]*<span[^>]*>សុខ ដារា/.test(html),
    "the Khmer name has its own line",
  );
});

test("a pending header reserves its row and claims nothing", () => {
  const pending = renderToStaticMarkup(
    <MiniIdentity
      pending employee={undefined} employeeName={undefined} khmerName={undefined}
      designation={undefined} branch={undefined} photoUrl={null}
    />,
  );
  // The landmark is still honestly named — it IS your record, whatever it
  // turns out to say — and aria-busy is what reports the rest is unknown.
  assert.match(pending, /aria-busy="true"/);
  // "Your record" ONCE, as the landmark's name — never as content. Printed
  // over an empty name it is a confirmation of nothing, which is the objection
  // that kept this row hidden entirely; as a landmark name it is just true.
  assert.match(pending, /aria-label="Your record"/);
  assert.equal(
    (pending.match(/Your record/g) ?? []).length, 1,
    "the placeholder names the landmark, not the person",
  );
  // And no initials: two letters guessed from nothing are a claim as well.
  assert.ok(!/\?\?/.test(pending), "nor invent initials");
  // Same skeleton, same two lines — the reserved height comes from the real
  // markup rather than a magic number that drifts the moment the header is
  // edited.
  assert.equal((pending.match(/<p /g) ?? []).length, 2);
});

test("the shell reserves the row while loading and renders nothing on error", () => {
  // A source read: `identity` is a react-query result this file cannot
  // construct, and the defect was in the CONDITION, which no render reaches.
  const shell = readFileSync(new URL("./MiniAppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /identity\.isError \? null : \(/);
  assert.match(shell, /pending=\{identity\.isLoading\}/);
  assert.ok(
    !/\{identity\.data \? \(/.test(shell),
    "waiting for the whole answer is what dropped the page 54px",
  );
});

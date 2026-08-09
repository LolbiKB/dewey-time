import { test, expect } from "@playwright/test";

import type { DecideFlagsResult } from "@/services/flags";
import type { FlagOut, QueueEntry, QueuePayload, QueuePerson } from "@/types/flags";

import { stubFrappe } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

// `/hr-flags` routing is wired server-side (hooks.py:90-91's website_route_rules,
// and the tracked `www/hr-flags.html` entry point) and guarded by
// `dewey_time/tests/test_hr_flags_route_wiring.py`. These specs still prove
// nothing about production routing either way: Playwright drives Vite's dev
// server (playwright.config.ts's `webServer`), and Vite's SPA fallback serves
// `index.html` for any path with no matching static file regardless of what
// Frappe does — direct navigation to `/hr-flags` works here whether or not the
// server-side route exists. That's exactly the gap the Python test above
// covers and this file structurally cannot.
//
// Every queue payload below is hand-built and must match `QueuePayload` in
// src/types/flags.ts field for field — including the ones nothing here asserts
// on. Two things enforce that, and BOTH are needed (issue #133):
//
//   1. `tsconfig.json` includes `e2e`, so `tsc --noEmit` sees this file at all.
//      It used to include only `src`. Playwright transpiles without type
//      checking, so nothing else ever would.
//   2. Every literal below carries a `satisfies` clause naming its contract
//      type. Without one, the payload's only consumer is
//      `JSON.stringify(...)` — an `unknown`-shaped sink — so the literal is
//      merely *inferred* and never *checked*, and step 1 alone catches nothing.
//
// `satisfies` rather than a `:` annotation on purpose: it checks the literal
// against the type while keeping the narrow inferred shape, so the property
// reads further down (`members[3].flags[0].flag_identity`) still resolve.
//
// A drifted payload does not fail as a type error without those two; it fails
// as "the row never rendered" — which is exactly how the person fields
// (`entry_key`, `dates`, `employee_image`, `also_count`, `also_outlier_count`)
// and `FlagOut.attendance_date` came to be missing here while the whole unit
// suite stayed green.

test("the flag queue renders groups and person rows with toolbar counts for HR staff", async ({
  page,
}) => {
  const queuePayload = {
    entries: [
      {
        kind: "group",
        group_type: "BRANCH_NO_DEVICE_DATA",
        group_key: "grp-device-siem-reap-2026-08-13",
        branch: "Siem Reap Depot",
        flag_code: null,
        attendance_date: "2026-08-13",
        dates: ["2026-08-13"],
        day_count: 1,
        rank: 140,
        tier: "act",
        members: [
          {
            entry_key: "grp-device-siem-reap-2026-08-13|p:EMP-301",
            employee: "EMP-301",
            employee_name: "Thida Sok",
            employee_branch: "Siem Reap Depot",
            employee_image: null,
            attendance_date: "2026-08-13",
            dates: ["2026-08-13"],
            rank: 140,
            tier: "act",
            flags: [
              {
                flag_identity: "AUTO-EMP-301-2026-08-13-attendance-issue-single_checkin",
                flag_code: "ATTENDANCE_ISSUE",
                attendance_date: "2026-08-13",
                severity: "WARNING",
                day_closed: 1,
                evidence: { reason: "single_checkin" },
                rank: 140,
                tier: "act",
                decision_state: "undecided",
                decision: null,
              },
            ],
            undecided_count: 1,
            also_count: 0,
            also_outlier_count: 0,
          },
          {
            entry_key: "grp-device-siem-reap-2026-08-13|p:EMP-302",
            employee: "EMP-302",
            employee_name: "Vireak Chan",
            employee_branch: "Siem Reap Depot",
            employee_image: null,
            attendance_date: "2026-08-13",
            dates: ["2026-08-13"],
            rank: 140,
            tier: "act",
            flags: [
              {
                flag_identity: "AUTO-EMP-302-2026-08-13-attendance-issue-single_checkin",
                flag_code: "ATTENDANCE_ISSUE",
                attendance_date: "2026-08-13",
                severity: "WARNING",
                day_closed: 1,
                evidence: { reason: "single_checkin" },
                rank: 140,
                tier: "act",
                decision_state: "undecided",
                decision: null,
              },
            ],
            undecided_count: 1,
            also_count: 0,
            also_outlier_count: 0,
          },
        ],
      },
      {
        kind: "group",
        group_type: "ROUTINE_CODE",
        group_key: "grp-routine-LATE_START-2026-08-14",
        branch: null,
        flag_code: "LATE_START",
        attendance_date: "2026-08-14",
        dates: ["2026-08-14"],
        day_count: 1,
        rank: 20,
        tier: "routine",
        members: [
          {
            entry_key: "grp-routine-LATE_START-2026-08-14|p:EMP-401",
            employee: "EMP-401",
            employee_name: "Leng Ratha",
            employee_branch: "BRANCH-A",
            employee_image: null,
            attendance_date: "2026-08-14",
            dates: ["2026-08-14"],
            rank: 20,
            tier: "routine",
            flags: [
              {
                flag_identity: "AUTO-EMP-401-2026-08-14-late_start",
                flag_code: "LATE_START",
                attendance_date: "2026-08-14",
                severity: "WARNING",
                day_closed: 1,
                evidence: { minutes: 12 },
                rank: 20,
                tier: "routine",
                decision_state: "undecided",
                decision: null,
              },
            ],
            undecided_count: 1,
            also_count: 0,
            also_outlier_count: 0,
          },
          {
            entry_key: "grp-routine-LATE_START-2026-08-14|p:EMP-402",
            employee: "EMP-402",
            employee_name: "Sopheak Meas",
            employee_branch: "BRANCH-A",
            employee_image: null,
            attendance_date: "2026-08-14",
            dates: ["2026-08-14"],
            rank: 20,
            tier: "routine",
            flags: [
              {
                flag_identity: "AUTO-EMP-402-2026-08-14-late_start",
                flag_code: "LATE_START",
                attendance_date: "2026-08-14",
                severity: "WARNING",
                day_closed: 1,
                evidence: { minutes: 25 },
                rank: 20,
                tier: "routine",
                decision_state: "undecided",
                decision: null,
              },
            ],
            undecided_count: 1,
            also_count: 0,
            also_outlier_count: 0,
          },
        ],
      },
      {
        kind: "person",
        entry_key: "p:EMP-001",
        employee: "EMP-001",
        employee_name: "Jane Doe",
        employee_branch: "BRANCH-A",
        employee_image: null,
        attendance_date: "2026-08-15",
        dates: ["2026-08-15"],
        rank: 150,
        tier: "act",
        flags: [
          {
            flag_identity: "AUTO-EMP-001-2026-08-15-unnotified_absence",
            flag_code: "UNNOTIFIED_ABSENCE",
            attendance_date: "2026-08-15",
            severity: "CRITICAL",
            day_closed: 1,
            evidence: {},
            rank: 150,
            tier: "act",
            decision_state: "undecided",
            decision: null,
          },
        ],
        undecided_count: 1,
        also_count: 0,
        also_outlier_count: 0,
      },
    ],
    // Every number here is one `build_queue` could actually return for these
    // entries. `people`/`rows` are `flag_grouping.recount` — three entries, five
    // distinct employees with something undecided across them. `open` counts the
    // five undecided flags below; an undecided flag can never be missing from the
    // list, so it cannot exceed them. `decided` can and does: those two settled
    // flags belong to people the default view drops, which is the whole reason
    // the toolbar reports the number.
    counts: { open: 5, needs_re_review: 0, open_capped: false, decided: 2, people: 5, rows: 3 },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    outage_dates: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  } satisfies QueuePayload;

  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: queuePayload }),
    });
  });

  await page.goto("/hr-flags");
  await expect(page).toHaveURL(/\/hr-flags/);
  await expect(page.getByText("Sign in required")).toHaveCount(0);

  // BRANCH_NO_DEVICE_DATA group: the design doc's cause-grouping rule 1 still
  // requires the branch name in the copy and still forbids a device serial, so
  // "Siem Reap Depot" is still guaranteed to appear — but no longer in a queue
  // row. An outage is a precondition, not a judgment about anybody, so it is
  // now the band above the queue (OutageBand). The band leads with what
  // happened and keeps its branch list behind a disclosure, collapsed on
  // arrival so thirteen branches cannot push the queue below the fold.
  const band = page.getByRole("region", { name: "Device outages" });
  await expect(band.getByText(/1 branch had no device data/)).toBeVisible();

  await band.getByRole("button", { name: /Review 1 branch/ }).click();
  await expect(band.getByText("Siem Reap Depot")).toBeVisible();

  // …and it left the queue: three entries came back, two of them are rows.
  // aria-setsize is the number a screen-reader user is actually told, so this
  // fails if the outage is still being listed as work waiting on HR.
  const list = page.getByRole("list", { name: "Flag queue" });
  await expect(list.getByRole("listitem").first()).toHaveAttribute("aria-setsize", "2");

  // The band must not have taken the queue's height to say so. `Section grow`
  // is `flex-1 basis-0`, whose flex shrink weight is zero, so every pixel the
  // band occupies comes out of the list — and on a phone the band's header row
  // wrapped itself to 474px and left the queue exactly 0. Visible, not merely
  // present: this is a height assertion wearing a visibility assertion's
  // clothes, and it is the only one of the two that a layout can fail.
  await expect(list.getByRole("listitem").first()).toBeVisible();

  // The header, against a payload whose own `counts` disagrees with all three
  // numbers in it: `people: 5, rows: 3` count the outage's two members and the
  // outage row along with the judgment work. Only the real page can catch these
  // — the split is computed in `FlagQueuePage`'s body, which the unit suite has
  // no react-query harness to reach.
  //
  //   3 people   = queuePeopleCount(queue): EMP-401, EMP-402, EMP-001
  //   2 rows     = queue.length, not counts.rows (3)
  //   2 waiting  = queuePeopleCount(outages): EMP-301, EMP-302
  await expect(
    page.getByText("3 people need a decision · 2 rows · 2 waiting on a device fault"),
  ).toBeVisible();

  // ROUTINE_CODE group: same rule's copy example ("168 late starts, 6–20
  // min…") turns on the flag label, formatted through the shared
  // `formatFlagLabel` helper the design doc names explicitly
  // (flagLabels.ts — reused here and again in Test 3).
  await expect(page.getByText(/Late start/i).first()).toBeVisible();

  // Ungrouped person row: headlined by `employee_name` (contract `Person`)
  // and its worst flag's label.
  await expect(page.getByText("Jane Doe").first()).toBeVisible();
  await expect(page.getByText("Did not show up")).toBeVisible();

  // Toolbar counts (design doc, UI section: "Toolbar counts: Open · Explained
  // · Needs re-review · Decided". "Explained" is Spec 2 scope and is not a
  // key on this endpoint's `counts` dict, so it is not asserted here).
  // Open and Needs re-review were permanent chips beside Decided; both are
  // gone from the toolbar now (Open moved into the header's description line
  // via queueSplitDescription, and Needs re-review read 0 on every day the
  // queue has ever seen — flag-queue-layout task 5). Decided is the one
  // survivor and the toolbar's only remaining count. The toggle button
  // renders `{label}<span>{value}</span>` with no whitespace between the JSX
  // expression and the following element, so its real DOM text content is
  // "Decided2" — a trailing `\b` fails between a letter and a digit. Anchor
  // at the start instead; a trailing `\b` is unnecessary once the match is
  // anchored to the button's own label prefix.
  await expect(page.getByText(/^Open/)).toHaveCount(0);
  await expect(page.getByText(/needs re-review/i)).toHaveCount(0);
  await expect(page.getByText(/^Decided/)).toBeVisible();

  // The two date buttons carry their name as visually-hidden CONTENT, not an
  // `aria-label` attribute: `aria-label` beats name-from-content
  // unconditionally, so it would have silenced the formatted date already
  // inside the button and left a screen reader hearing a bare "From"/"To"
  // with the current range excluded — on the control that determines the
  // entire list. `getByRole` resolves the real accessible name end to end,
  // computed the same way a screen reader would (unlike a `grep` over
  // `aria-label="From"`, which kept passing through that exact regression).
  // The date pattern after the name, not a bare `/^From/`, is the point:
  // "From" alone is also a substring match of the broken, date-less name, so
  // asserting only that prefix would pass whether or not this bug existed.
  await expect(page.getByRole("button", { name: /^From \w{3} \d{1,2}, \d{4}/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^To \w{3} \d{1,2}, \d{4}/ })).toBeVisible();
});

test("a single decision persists after the queue refetches", async ({ page }) => {
  // Unlike attendance.spec.ts's day inspector (a genuine separate mobile
  // surface — DayInspectorSheet.tsx — covered instead by
  // mobile-surfaces.spec.ts), the flag queue has no breakpoint-conditional
  // component anywhere in this path: FlagQueuePage.tsx's grid just collapses
  // to a single column below `md` with the panel stacked under the list, and
  // FlagDecisionPanel.tsx/FlagQueueList.tsx have no useIsMobile, sheet, or
  // other mobile branch. Same Decide button, same native <select>, same
  // submit button at every viewport, so this runs on both projects.

  const FLAG_IDENTITY = "AUTO-EMP-201-2026-08-13-late_start";
  const FLAG_DATE = "2026-08-13";
  const undecidedFlag = {
    flag_identity: FLAG_IDENTITY,
    flag_code: "LATE_START",
    attendance_date: FLAG_DATE,
    severity: "WARNING",
    day_closed: 1,
    evidence: { minutes: 75 },
    rank: 65,
    tier: "review",
    decision_state: "undecided",
    decision: null,
  } satisfies FlagOut;
  const decidedFlag = {
    ...undecidedFlag,
    decision_state: "matched",
    decision: {
      name: "AFD-0001",
      outcome: "EXCUSED",
      reason: "APPROVED_LEAVE",
      note: null,
      decided_by: "hr@example.com",
      decided_at: "2026-08-13 09:00:00",
      group_key: "grp-single-0001",
    },
  } satisfies FlagOut;

  // `p:<employee>`, with no group prefix: a lone person row is exactly what
  // `flag_grouping._entries_for` stamps that way, and it is the key the page
  // holds as its selection across the refetch this test is about. The parameter
  // is the contract type rather than `typeof undecidedFlag`: `satisfies` keeps
  // each literal's narrow shape, so the undecided one's `decision: null` would
  // otherwise reject the decided one.
  function personEntry(flag: FlagOut, undecidedCount: number) {
    return {
      kind: "person",
      entry_key: "p:EMP-201",
      employee: "EMP-201",
      employee_name: "Noor Aziz",
      employee_branch: "BRANCH-A",
      employee_image: null,
      attendance_date: FLAG_DATE,
      // The distinct dates of THIS entry's flags — one flag, one date.
      dates: [FLAG_DATE],
      rank: 65,
      tier: "review",
      flags: [flag],
      undecided_count: undecidedCount,
      // In one entry only, so no cross-reference badge.
      also_count: 0,
      also_outlier_count: 0,
    } satisfies QueueEntry;
  }

  // Everything a `QueuePayload` carries except the two keys that differ between
  // the two responses below; those are checked where the halves are assembled.
  const basePayload = {
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    outage_dates: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  } satisfies Omit<QueuePayload, "entries" | "counts">;

  // Stateful mock: the queue reads undecided on the first GET (page load) and
  // decided on every GET after — the second call is the refetch the decide
  // write triggers, per the design doc's "queue refetches" language in Error
  // handling and per `_QUEUE_CACHE_TTL_SECONDS` being invalidated on write.
  let queueCalls = 0;
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (p.includes("get_flag_queue")) {
      queueCalls += 1;
      // One row either way; `people` counts only employees with something still
      // undecided (flag_grouping.recount), so it drops to 0 once the flag is
      // decided even though the row is still on screen.
      const payload =
        queueCalls === 1
          ? ({
              ...basePayload,
              entries: [personEntry(undecidedFlag, 1)],
              counts: { open: 1, needs_re_review: 0, open_capped: false, decided: 0, people: 1, rows: 1 },
            } satisfies QueuePayload)
          : ({
              ...basePayload,
              entries: [personEntry(decidedFlag, 0)],
              counts: { open: 0, needs_re_review: 0, open_capped: false, decided: 1, people: 0, rows: 1 },
            } satisfies QueuePayload);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: payload }),
      });
    }

    if (p.includes("decide_flags")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: {
            ok: true,
            written: 1,
            group_key: "grp-single-0001",
            errors: [],
          } satisfies DecideFlagsResult,
        }),
      });
    }

    return route.fallback();
  });

  await page.goto("/hr-flags");
  await expect(page.getByText("Noor Aziz").first()).toBeVisible();

  // Before deciding: neither the outcome word nor the reason label the
  // decision would carry is on the page yet — this is the "undecided" half
  // of the assertion, expressed as absence rather than by guessing the
  // undecided-state copy (which the design doc never quotes literally).
  await expect(page.getByText("Excused")).toHaveCount(0);
  await expect(page.getByText("Approved leave or holiday")).toHaveCount(0);

  await page.getByText("Noor Aziz").first().click();

  // Selecting the person only reveals its flag card; the decision form
  // (reason picker, note, submit) is gated behind its own button
  // (FlagDecisionPanel.tsx's FlagCard: `props.open ? <DecisionForm/> :
  // <Button>{decided ? DECIDE_AGAIN_LABEL : "Decide"}</Button>`), so it must be
  // opened before the reason control exists in the DOM. `exact` because
  // Playwright's `name` is a substring match and the toolbar's "Decided" chip is
  // a button too — the toggle that surfaces already-decided people.
  await page.getByRole("button", { name: "Decide", exact: true }).click();

  // Reason is the closed 7-item vocabulary (contract `REASONS`); its label
  // text is the design doc's own copy, quoted under a `Labels:` heading. The
  // control itself is a plain HTML <select> (FlagDecisionPanel.tsx picked a
  // native select over Radix's portal-rendered one, deliberately, per its own
  // comment) — HTML-AAM maps a single, non-multiple <select> to role
  // "combobox", but its <option>s live in a native OS popup outside the page,
  // so `click()` on a role="option" locator can never find them; `selectOption`
  // is the native-select equivalent.
  await page
    .getByRole("combobox", { name: /reason/i })
    .selectOption({ label: "Approved leave or holiday" });

  // "Excuse" (optionally with a live count) both sets outcome=EXCUSED and
  // submits — the group-decide precedent for this exact button is "Excuse 39"
  // in the design doc's per-member-exclusion paragraph; for a single flag the
  // count is implicit, so the submit button's name is bare "Excuse" — which
  // collides with the EXCUSED/UPHELD outcome toggle above it (also labelled
  // "Excuse", already active by default). `.last()` picks the submit button,
  // which the DecisionForm renders after the toggle group in DOM order.
  await page.getByRole("button", { name: /^Excuse\b/ }).last().click();

  // The write lands and react-query invalidates + refetches — this is the
  // second `get_flag_queue` call our route handler is keyed on.
  await expect(page.getByText("Approved leave or holiday")).toBeVisible();
  await expect(page.getByText("Excused")).toBeVisible();
  expect(queueCalls).toBeGreaterThanOrEqual(2);
});

test("a bulk decision with one stale row reports partial failure, politely", async ({
  page,
}) => {
  // No mobile-only skip here either — same reasoning as the single-decision
  // test above: GroupDecision (FlagDecisionPanel.tsx) has no breakpoint
  // branch, so the bulk form is the same component tree on both projects.

  const GROUP_KEY = "grp-routine-LATE_START-2026-08-14-bulk";
  const names = ["Aiko Tan", "Ben Souza", "Cleo Marsh", "Dara Sok", "Elan Rios"];

  const FLAG_DATE = "2026-08-14";

  function memberFlag(n: number) {
    return {
      flag_identity: `AUTO-EMP-5${n}-${FLAG_DATE}-late_start`,
      flag_code: "LATE_START",
      attendance_date: FLAG_DATE,
      severity: "WARNING",
      day_closed: 1,
      evidence: { minutes: 15 + n },
      rank: 20,
      tier: "routine",
      decision_state: "undecided",
      decision: null,
    } satisfies FlagOut;
  }

  // `<group_key>|p:<employee>`, the form `flag_grouping._entries_for` stamps on a
  // group member — a bare `p:<employee>` would collide with the same person's lone
  // row if they had one, which is the collision the prefix exists to prevent.
  function member(n: number, name: string) {
    return {
      entry_key: `${GROUP_KEY}|p:EMP-5${n}`,
      employee: `EMP-5${n}`,
      employee_name: name,
      employee_branch: "BRANCH-A",
      employee_image: null,
      attendance_date: FLAG_DATE,
      dates: [FLAG_DATE],
      rank: 20,
      tier: "routine",
      flags: [memberFlag(n)],
      undecided_count: 1,
      // Each of these five is in this group and nowhere else.
      also_count: 0,
      also_outlier_count: 0,
    } satisfies QueuePerson;
  }

  const members = names.map((name, i) => member(i, name));
  // Two of five rows changed underneath the bulk action (their evidence no
  // longer matches — see the design doc's `evidence_fingerprint` staleness
  // guard) and are reported as errors; the other three still write.
  const staleIdentities = [members[3].flags[0].flag_identity, members[4].flags[0].flag_identity];

  const queuePayload = {
    entries: [
      {
        kind: "group",
        group_type: "ROUTINE_CODE",
        group_key: GROUP_KEY,
        branch: null,
        flag_code: "LATE_START",
        attendance_date: FLAG_DATE,
        dates: [FLAG_DATE],
        day_count: 1,
        rank: 20,
        tier: "routine",
        members,
      },
    ],
    // One entry — the group — holding all five people (flag_grouping.recount
    // counts group members as people, which is what keeps the header from
    // reading "1 row" over five names).
    counts: { open: 5, needs_re_review: 0, open_capped: false, decided: 0, people: 5, rows: 1 },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    outage_dates: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  } satisfies QueuePayload;

  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (p.includes("get_flag_queue")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: queuePayload }),
      });
    }

    if (p.includes("decide_flags")) {
      // 3 of 5 saved; the other 2 are reported back as errors — this mirrors
      // the design doc's Error handling example almost verbatim ("34 of 39
      // saved — 5 flags changed while you were deciding").
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: {
            ok: false,
            written: 3,
            group_key: GROUP_KEY,
            errors: staleIdentities.map((flag_identity) => ({
              flag_identity,
              error: "Flag no longer matches recorded evidence",
            })),
          } satisfies DecideFlagsResult,
        }),
      });
    }

    return route.fallback();
  });

  await page.goto("/hr-flags");
  // There is exactly one group entry in this payload, so its own flag-code
  // label ("Late start") is an unambiguous, single-match anchor for the
  // group's card before anything is selected — same locator Test 1 already
  // exercises for the same reason.
  await expect(page.getByText(/Late start/i).first()).toBeVisible();
  await page.getByText(/Late start/i).first().click();

  // Same native-<select> reality as the single-decision test above:
  // selectOption(), not click()+role("option").
  await page
    .getByRole("combobox", { name: /reason/i })
    .selectOption({ label: "Approved leave or holiday" });

  // All 5 members are checked by default (design doc: "Selecting a cause
  // group shows its members with checkboxes, all checked by default"), so
  // the live count on the bulk button reads 5 — "Excuse 5", the same pattern
  // as the design doc's "Excuse 39" example. Unlike the single-decision test,
  // this name is unambiguous: the outcome toggle's label is bare "Excuse"
  // with no count, so only the submit button's name contains "5".
  await page.getByRole("button", { name: /Excuse.*5/i }).click();

  await expect(
    page.getByText(/3 of 5 saved.*2 flags changed while you were deciding/)
  ).toBeVisible();

  // Partial failure is Role 2 — AttentionStrip, role="status" — never Role 3
  // — FailureBlock, role="alert" (components/ui/notice.tsx:14-16: "role=
  // 'status' is polite on purpose: stale device data must not interrupt a
  // screen reader mid-sentence"). A write that half-succeeded is exactly that
  // case, not a hard failure, so no role="alert" element should exist at all.
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a decided flag is reachable and can be decided again", async ({ page }) => {
  // The correction path. Every other spec in this file makes a FIRST decision;
  // this is the only way HR can fix one they got wrong — decide the same flag
  // again, which the backend records as a new row superseding the old one.
  // Two links in that chain have no unit coverage and both fail SILENTLY:
  // the `include_decided` request parameter (Frappe ignores an argument the
  // endpoint does not declare, so a renamed one leaves the toggle doing
  // nothing) and the identity in the re-decide body (the wrong value writes a
  // second live decision instead of superseding, and raises nothing).
  //
  // No mobile skip, same reasoning as the specs above: the toolbar chip and the
  // decision form are the same component tree at every viewport.

  const FLAG_IDENTITY = "AUTO-EMP-201-2026-08-13-late_start";
  const FLAG_DATE = "2026-08-13";
  const decidedFlag = {
    flag_identity: FLAG_IDENTITY,
    flag_code: "LATE_START",
    attendance_date: FLAG_DATE,
    severity: "WARNING",
    day_closed: 1,
    evidence: { minutes: 75 },
    rank: 65,
    tier: "review",
    decision_state: "matched",
    decision: {
      name: "AFD-0001",
      outcome: "EXCUSED",
      reason: "APPROVED_LEAVE",
      note: null,
      decided_by: "hr@example.com",
      decided_at: "2026-08-13 09:00:00",
      group_key: "grp-single-0001",
    },
  } satisfies FlagOut;

  const settledPerson = {
    kind: "person",
    entry_key: "p:EMP-201",
    employee: "EMP-201",
    employee_name: "Noor Aziz",
    employee_branch: "BRANCH-A",
    employee_image: null,
    attendance_date: FLAG_DATE,
    dates: [FLAG_DATE],
    // A settled person ranks 0: rank comes from the worst UNRESOLVED flag and
    // they have none (flag_grouping._person).
    rank: 0,
    tier: "routine",
    flags: [decidedFlag],
    undecided_count: 0,
    also_count: 0,
    also_outlier_count: 0,
  } satisfies QueueEntry;

  const basePayload = {
    // `people` is 0 in both views: it counts employees with something still
    // undecided, and the only person here has nothing. `rows` is not in here —
    // it is the length of whichever entry list the response carries, so it is
    // filled in below rather than shared between the two.
    counts: { open: 0, needs_re_review: 0, open_capped: false, decided: 1, people: 0 },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    outage_dates: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  } satisfies Omit<QueuePayload, "entries" | "counts"> & {
    counts: Omit<QueuePayload["counts"], "rows">;
  };

  const queueParams: (string | null)[] = [];

  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (p.includes("get_flag_queue")) {
      const includeDecided = url.searchParams.get("include_decided");
      queueParams.push(includeDecided);
      // The default view genuinely does not contain this person — which is the
      // entire reason the toggle has to exist. `rows` follows the list rather
      // than being pinned to one number, because the backend recounts it per
      // response and the header would otherwise claim a row that is not there.
      const entries = includeDecided ? [settledPerson] : [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: {
            ...basePayload,
            entries,
            counts: { ...basePayload.counts, rows: entries.length },
          } satisfies QueuePayload,
        }),
      });
    }

    if (p.includes("decide_flags")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: {
            ok: true,
            written: 1,
            group_key: "grp-single-0002",
            errors: [],
          } satisfies DecideFlagsResult,
        }),
      });
    }

    return route.fallback();
  });

  await page.goto("/hr-flags");
  // "Nothing to triage in this range." is FlagQueueList's own fallback, and it
  // never mounts here: an empty judgment queue with no outages renders the
  // richer "Nothing waiting" state in FlagQueueView instead (flag-queue-layout
  // Task 6), so this is the text actually on screen.
  await expect(page.getByText("Nothing waiting")).toBeVisible();
  await expect(page.getByText("Noor Aziz")).toHaveCount(0);

  // The Decided count is the control: it already answers "how many", so it also
  // answers "show me".
  await page.getByRole("button", { name: /^Decided/ }).click();

  await expect(page.getByText("Noor Aziz").first()).toBeVisible();
  expect(queueParams[0]).toBeNull();
  expect(queueParams).toContain("1");

  await page.getByText("Noor Aziz").first().click();
  // The decision in force is readable before anything replaces it.
  await expect(page.getByText("Excused — Approved leave or holiday")).toBeVisible();

  await page.getByRole("button", { name: "Decide again" }).click();
  await page
    .getByRole("combobox", { name: /reason/i })
    .selectOption({ label: "Genuine violation" });
  // UPHELD, the opposite of the decision in force — a correction, not a repeat.
  // The first click is the outcome toggle (the only "Uphold" on the page while
  // the draft still reads EXCUSED); filling the note then enables the submit
  // button, which the same label now names — `.last()` in DOM order, the same
  // idiom as the single-decision spec above.
  await page.getByRole("button", { name: /^Uphold\b/ }).click();
  await page.getByPlaceholder("Note").fill("Manager confirmed no approval was given.");

  const decidePost = page.waitForRequest((request) => request.url().includes("decide_flags"));
  await page.getByRole("button", { name: /^Uphold\b/ }).last().click();
  const body = (await decidePost).postDataJSON();

  // The SAME identity as the decision being replaced: that is what makes the
  // backend supersede rather than leave two live decisions on one flag.
  expect(body.identities).toEqual([FLAG_IDENTITY]);
  expect(body.outcome).toBe("UPHELD");
  expect(body.reason).toBe("GENUINE_VIOLATION");
});

test("a person row's avatar loading ring stays out of the accessibility tree", async ({ page }) => {
  // Issue #130. `FlagQueueList.tsx`'s `DecorativeAvatars` puts `aria-hidden` on a
  // `display: contents` span, and `EmployeeAvatar`'s loading ring is a
  // `role="status"` LIVE REGION. Forty rows of lazily-loaded photos would queue
  // forty "Loading" announcements if that `aria-hidden` did not take, and
  // `display: contents` removes the element from the box tree — historically the
  // exact case engines have disagreed on. Nothing proved it worked.
  //
  // The unit suite structurally cannot: it renders with `renderToStaticMarkup`,
  // so `useEffect` never runs, `delayElapsed` stays false, and `showsRing` is
  // never true — the ring does not exist to be checked. It takes a real engine.
  //
  // Chromium ONLY. Both playwright.config.ts projects (Desktop Chrome, Pixel 7)
  // are Chromium and the CDP block below is a Chromium protocol, so this proves
  // nothing about Gecko or WebKit. That is the honest scope of the claim.

  // A photo the browser asks for and never receives, so the avatar is pinned in
  // its `loading` phase past AVATAR_RING_DELAY_MS and the ring actually renders.
  const AVATAR_URL = "/e2e-avatar-never-arrives.png";

  const queuePayload = {
    entries: [
      {
        kind: "person",
        entry_key: "p:EMP-900",
        employee: "EMP-900",
        employee_name: "Nita Prum",
        employee_branch: "BRANCH-A",
        employee_image: AVATAR_URL,
        attendance_date: "2026-08-15",
        dates: ["2026-08-15"],
        rank: 150,
        tier: "act",
        flags: [
          {
            flag_identity: "AUTO-EMP-900-2026-08-15-unnotified_absence",
            flag_code: "UNNOTIFIED_ABSENCE",
            attendance_date: "2026-08-15",
            severity: "CRITICAL",
            day_closed: 1,
            evidence: {},
            rank: 150,
            tier: "act",
            decision_state: "undecided",
            decision: null,
          },
        ],
        undecided_count: 1,
        also_count: 0,
        also_outlier_count: 0,
      },
    ],
    counts: { open: 1, needs_re_review: 0, open_capped: false, decided: 0, people: 1, rows: 1 },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    outage_dates: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  } satisfies QueuePayload;

  // Deliberately never fulfilled, aborted, or continued. An abort would fire the
  // <img>'s `error` handler, move the phase to `failed`, and take the ring back
  // off screen — the one thing this test needs on screen. A hanging route is
  // discarded when the context closes.
  await page.route(`**${AVATAR_URL}`, () => {});

  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: queuePayload }),
    });
  });

  await page.goto("/hr-flags");

  // Located by CSS, not by role: every later assertion here is about the
  // accessibility tree, so the scope they are measured in must not be.
  // `aria-label`, not `aria-pressed`: rows are single-select navigation and
  // carry aria-current when chosen, so aria-pressed no longer exists on them —
  // and aria-current is absent until something is selected, which this test
  // never does. Every row has a label, so that is the stable hook.
  const row = page.locator("button[aria-label]").filter({ hasText: "Nita Prum" });
  await expect(row).toHaveCount(1);

  // THE GUARD, and the most important line in this test. Without it, everything
  // below passes whether or not `aria-hidden` works — a ring that never rendered
  // is also a ring that is not exposed. `[role="status"]` is a plain attribute
  // selector, so it sees the element regardless of `aria-hidden`; `animate-spin`
  // pins that what rendered is the ring and not something else wearing the role.
  // This retries, which is also how the test waits out AVATAR_RING_DELAY_MS.
  await expect(row.locator('svg[role="status"].animate-spin')).toHaveCount(1);

  // Playwright's own ARIA implementation: `getByRole` skips `aria-hidden`
  // subtrees, so a hit here means a screen reader would have one too.
  await expect(row.getByRole("status")).toHaveCount(0);

  // And now the engine itself, which is the actual question — the above is
  // Playwright's opinion of the markup, not Blink's. `Accessibility.getFullAXTree`
  // is Blink's real tree, the one a platform screen reader reads.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");

  async function exposedNodes() {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const live = nodes.filter((node) => !node.ignored);
    const named = (node: (typeof live)[number]) => String(node.name?.value ?? "");
    return {
      // The ring, identified by its own name rather than by role alone. The page
      // now also carries a legitimate `role="status"` live region for decision
      // outcomes, so a bare role count would score that as a failure.
      ring: live.filter((node) => node.role?.value === "status" && /Loading/i.test(named(node)))
        .length,
      namedLoading: live.filter((node) => node.name?.value === "Loading").length,
      // The positive control, and the reason this assertion is not vacuous: the
      // row itself, exposed and named, proves the tree was populated and that we
      // are looking at the right part of it. Without a control, an empty tree
      // reads as a pass.
      //
      // This used to be the flag strip — a `role="img"` sibling inside the same
      // <button>, deliberately unhidden. It is no longer separately exposed, and
      // that is expected: the row now carries an explicit `aria-label`, so Blink
      // stops walking its descendants for the name and prunes them. Nothing is
      // lost to a screen reader — `stripAriaLabel` is part of that label, pinned
      // by "every queue row has an accessible name carrying its finding" below.
      row: live.filter((node) => node.role?.value === "button" && /Nita Prum/.test(named(node)))
        .length,
    };
  }

  // Polled: the AX tree is built off the main thread's commit, so it can lag the
  // DOM by a frame.
  await expect.poll(exposedNodes).toEqual({ ring: 0, namedLoading: 0, row: 1 });
});

// ---------------------------------------------------------------------------
// Keyboard and screen-reader access to the queue list.
//
// These live here rather than in the unit suite for a structural reason: that
// suite is `renderToStaticMarkup` plus regex over the HTML string, and a markup
// string has no accessibility tree, no focus and no key events. It could not
// have caught ANY of what follows — which is how a 252-row list shipped with no
// accessible names, no keyboard model and nothing announced.
// ---------------------------------------------------------------------------

function a11yPerson(args: { employee: string; name: string; minutes: number }): QueuePerson {
  const flag = {
    flag_identity: `AUTO-${args.employee}`,
    flag_code: "MISSING_TIME",
    attendance_date: "2026-08-13",
    severity: "WARNING",
    day_closed: 1,
    evidence: { minutes: args.minutes },
    rank: 134,
    tier: "act",
    decision_state: "undecided",
    decision: null,
  } satisfies FlagOut;
  return {
    entry_key: `p:${args.employee}`,
    employee: args.employee,
    employee_name: args.name,
    employee_branch: "Siem Reap Depot",
    employee_image: null,
    attendance_date: "2026-08-13",
    dates: ["2026-08-13"],
    rank: 134,
    tier: "act",
    flags: [flag],
    undecided_count: 1,
    also_count: 0,
    also_outlier_count: 0,
  } satisfies QueuePerson;
}

const A11Y_PEOPLE = [
  a11yPerson({ employee: "HR-EMP-00021", name: "Vandy In", minutes: 240 }),
  a11yPerson({ employee: "HR-EMP-00022", name: "Sokha Phlat", minutes: 250 }),
  a11yPerson({ employee: "HR-EMP-00023", name: "Dara Kim", minutes: 260 }),
];

const A11Y_PAYLOAD = {
  entries: A11Y_PEOPLE.map((person) => ({ kind: "person", ...person })) satisfies QueueEntry[],
  counts: {
    open: 3,
    needs_re_review: 0,
    decided: 0,
    people: 3,
    rows: 3,
    open_capped: false,
  },
  orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
  alerts: [],
  outage_dates: [],
  truncated: false,
  start_date: "2026-07-31",
  end_date: "2026-08-13",
} satisfies QueuePayload;

async function gotoA11yQueue(page: import("@playwright/test").Page) {
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: A11Y_PAYLOAD }),
    });
  });
  await page.goto("/hr-flags");
  await expect(page.getByRole("button", { name: /Vandy In/ })).toBeVisible();
}

test("every queue row has an accessible name carrying its finding", async ({ page }) => {
  await gotoA11yQueue(page);

  // getByRole with a name is the whole assertion: it resolves against the
  // accessibility tree, so it fails outright if the row is an unnamed button —
  // which is what all 252 of them were. A CSS selector would pass either way.
  const row = page.getByRole("button", { name: /Vandy In/ });
  await expect(row).toHaveCount(1);

  const label = await row.getAttribute("aria-label");
  expect(label).toContain("Vandy In");
  expect(label).toMatch(/gap|Missing/i); // the finding, not just the name
  expect(label).toMatch(/flagged day/); // and the fortnight the strip draws

  // Every row, not just the one we looked at.
  for (const person of A11Y_PEOPLE) {
    await expect(page.getByRole("button", { name: new RegExp(person.employee_name) })).toHaveCount(1);
  }
});

test("the list is a list, and says how long it is", async ({ page }) => {
  await gotoA11yQueue(page);

  const list = page.getByRole("list", { name: "Flag queue" });
  await expect(list).toHaveCount(1);
  // "item N of 3" is the fact that tells a screen-reader user whether this
  // queue is a five-minute job or an afternoon.
  await expect(list.getByRole("listitem").first()).toHaveAttribute("aria-setsize", "3");
  await expect(list.getByRole("listitem").first()).toHaveAttribute("aria-posinset", "1");
});

test("one tab reaches the list, then the arrows move within it", async ({ page }) => {
  await gotoA11yQueue(page);

  const rows = page.getByRole("button", { name: /Vandy In|Sokha Phlat|Dara Kim/ });
  await expect(rows).toHaveCount(3);

  // Roving tabindex: exactly one row is tabbable, so reaching the panel does not
  // cost 252 Tab presses.
  await expect(page.locator('button[aria-label*="Vandy In"]')).toHaveAttribute("tabindex", "0");
  await expect(page.locator('button[aria-label*="Sokha Phlat"]')).toHaveAttribute("tabindex", "-1");

  await page.locator('button[aria-label*="Vandy In"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('button[aria-label*="Sokha Phlat"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('button[aria-label*="Dara Kim"]')).toBeFocused();
  // Clamped at the end rather than wrapping — wrapping past the last row reads
  // as "the list restarted" when you cannot see it.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('button[aria-label*="Dara Kim"]')).toBeFocused();

  await page.keyboard.press("Home");
  await expect(page.locator('button[aria-label*="Vandy In"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator('button[aria-label*="Dara Kim"]')).toBeFocused();
});

test("a row can be selected from the keyboard, and says so", async ({ page }) => {
  await gotoA11yQueue(page);

  await page.locator('button[aria-label*="Vandy In"]').focus();
  await page.keyboard.press("Enter");

  // aria-current, not aria-pressed: single-select navigation, not a toggle.
  await expect(page.locator('button[aria-label*="Vandy In"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.locator('button[aria-label*="Sokha Phlat"]')).not.toHaveAttribute(
    "aria-current",
    "true",
  );

  // The panel is a named region, so a screen reader can jump to it rather than
  // tabbing through the rest of the list to find where the row went.
  await expect(page.getByRole("region", { name: "Selected flag" })).toBeVisible();
});

test("the queue carries a polite live region for its own state changes", async ({ page }) => {
  await gotoA11yQueue(page);
  const live = page.locator('[role="status"][aria-live="polite"]');
  await expect(live).toHaveCount(1);
});

test("deciding a row lands focus on the row that takes its place", async ({ page }) => {
  // Explicitly >= lg: landing focus ON A ROW is the split's answer, where the
  // list is beside the panel and still visible. Below lg the panel is a modal
  // and Radix marks the list behind it `aria-hidden="true"`, so focusing a row
  // there would put the keyboard on an element the accessibility tree says does
  // not exist — the page deliberately leaves focus inside the sheet instead,
  // which "after a phone write, focus does not land behind the sheet" covers.
  // Set here rather than at project level so it runs identically in both.
  await page.setViewportSize({ width: 1280, height: 900 });
  // The list shrinks by one on the refetch, exactly as it does in production
  // once the server says every flag on that person is settled.
  let decided = false;
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("decide_flags")) {
      decided = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { ok: true, written: 1, group_key: "AFD-x", errors: [] } satisfies DecideFlagsResult,
        }),
      });
    }
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    const remaining = decided ? A11Y_PEOPLE.slice(1) : A11Y_PEOPLE;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: remaining.map((person) => ({ kind: "person", ...person })),
          counts: {
            ...A11Y_PAYLOAD.counts,
            open: remaining.length,
            people: remaining.length,
            rows: remaining.length,
          } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Vandy In"]').click();
  await expect(page.getByRole("region", { name: "Selected flag" })).toBeVisible();

  // Same three steps as the decide test above: the form is gated behind its own
  // "Decide" button, reason is a native <select>, and the submit button shares
  // its name with the outcome toggle so `.last()` picks the submit.
  await page.getByRole("button", { name: "Decide", exact: true }).click();
  await page
    .getByRole("combobox", { name: /reason/i })
    .selectOption({ label: "Approved leave or holiday" });
  await page.getByRole("button", { name: /^Excuse\b/ }).last().click();

  // Vandy In is gone; the slot she occupied now holds Sokha Phlat, and that is
  // where focus and selection must be. Before this the decided button unmounted
  // and focus fell to <body> — a keyboard user was returned to the top of the
  // document, and the panel reverted to its empty state with no statement that
  // anything had been saved.
  await expect(page.locator('button[aria-label*="Vandy In"]')).toHaveCount(0);
  await expect(page.locator('button[aria-label*="Sokha Phlat"]')).toBeFocused();
  await expect(page.locator('button[aria-label*="Sokha Phlat"]')).toHaveAttribute(
    "aria-current",
    "true",
  );

  // And the write is announced, rather than being inferable only from absence.
  await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(/saved/i);
});

test("the next row's form is empty after a decide, not pre-filled with the last one's", async ({
  page,
}) => {
  let decided = false;
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("decide_flags")) {
      decided = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { ok: true, written: 1, group_key: "AFD-y", errors: [] } satisfies DecideFlagsResult,
        }),
      });
    }
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    const remaining = decided ? A11Y_PEOPLE.slice(1) : A11Y_PEOPLE;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: remaining.map((person) => ({ kind: "person", ...person })),
          counts: {
            ...A11Y_PAYLOAD.counts,
            open: remaining.length,
            people: remaining.length,
            rows: remaining.length,
          } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Vandy In"]').click();
  await page.getByRole("button", { name: "Decide", exact: true }).click();
  await page
    .getByRole("combobox", { name: /reason/i })
    .selectOption({ label: "Approved leave or holiday" });
  // A note is the sharpest version of the leak: free text about ONE person.
  await page.getByRole("textbox").first().fill("Spoke to Vandy, family emergency");
  await page.getByRole("button", { name: /^Excuse\b/ }).last().click();

  // We land on Sokha Phlat. Opening her form must not present Vandy's note or
  // Vandy's reason as if they were hers — resetRowState's own stated error,
  // "one person's reasoning applied to the next".
  //
  // Selection, not focus: the leak this test is about is layout-independent and
  // matters at least as much below lg, where dismissing the sheet is a NEW
  // deselection path. Focus is not — below lg the page deliberately leaves it
  // inside the sheet rather than on a row behind `aria-hidden`, so asserting
  // `toBeFocused` here would pin the split's answer onto both layouts and this
  // test would stop running on a phone at all.
  await expect(page.locator('button[aria-label*="Sokha Phlat"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: "Decide", exact: true }).click();
  await expect(page.getByRole("textbox").first()).toHaveValue("");
});

/** The a11y queue's three people, plus the branch whose reader died that day. */
const A11Y_OUTAGE = {
  kind: "group",
  group_type: "BRANCH_NO_DEVICE_DATA",
  group_key: "BRANCH_NO_DEVICE_DATA:Siem Reap Depot",
  branch: "Siem Reap Depot",
  flag_code: null,
  attendance_date: "2026-08-13",
  dates: ["2026-08-13"],
  day_count: 1,
  // Ranked ABOVE the person rows on purpose. Interleaving is what makes the two
  // arrays disagree: with the outage first, every person's slot in `entries` is
  // one further down than its slot in the rendered list, and removing the
  // outage shifts them all back again.
  rank: 140,
  tier: "act",
  members: [
    a11yPerson({ employee: "HR-EMP-00031", name: "Chanthou Ny", minutes: 300 }),
    a11yPerson({ employee: "HR-EMP-00032", name: "Rithy Sen", minutes: 310 }),
  ],
} satisfies QueueEntry;

// The band's write must not run the panel's success path. `decide` is shared by
// both surfaces, and its onSuccess arms two effects scoped to the SELECTED
// PERSON: the "Same reason applies" repeat, and the post-write restore. A band
// excuse that ran either would leave a device-fault reason one click from an
// unrelated person's genuine attendance flags, and would carry the user off the
// row they were working on — the excuse removes the outage entries, so every
// later slot shifts. Both are reachable by an ordinary sequence: select a row,
// notice the amber band, click Excuse.
test("a band excuse leaves the selected person's row and form alone", async ({ page }) => {
  // Explicitly ≥ lg, the same way the pin test below is explicitly short: the
  // sequence this describes — select a row, start typing, notice the band,
  // click Excuse — needs the panel and the band reachable AT ONCE, and that is
  // the split's property. Below lg the panel is a modal that covers the band
  // and puts it behind `aria-hidden`, so the band's button cannot be clicked
  // without dismissing the form first. What is being tested (a band write is
  // scoped to the band) is layout-independent; only this way of reaching it is
  // not. Set here rather than at project level so it runs identically in both.
  await page.setViewportSize({ width: 1280, height: 900 });
  let excused = false;
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("decide_flags")) {
      excused = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { ok: true, written: 2, group_key: "AFD-band", errors: [] } satisfies DecideFlagsResult,
        }),
      });
    }
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    // The outage leaves the payload once excused, exactly as it does in
    // production once every flag behind it is settled.
    const entries: QueueEntry[] = [
      ...(excused ? [] : [A11Y_OUTAGE]),
      ...A11Y_PEOPLE.map((person) => ({ kind: "person", ...person }) satisfies QueueEntry),
    ];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries,
          counts: { ...A11Y_PAYLOAD.counts, people: 5, rows: 4 } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  const vandy = page.locator('button[aria-label*="Vandy In"]');
  await vandy.click();
  await expect(vandy).toHaveAttribute("aria-current", "true");

  // Mid-sentence about Vandy — the sequence in full is: select a row, start
  // typing, notice the amber band, click Excuse. The free-text note is the
  // sharpest thing to lose, because it is the only part of a decision that
  // cannot be retyped from the row itself.
  const note = "Spoke to Vandy, family emergency";
  await page.getByRole("button", { name: "Decide", exact: true }).click();
  await page.getByRole("textbox").first().fill(note);

  const band = page.getByRole("region", { name: "Device outages" });
  await band.getByRole("button", { name: /^Excuse\b/ }).click();

  // The write landed, was announced, and cleared the band.
  await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(/saved/i);
  await expect(band).toHaveCount(0);

  // None of it was about Vandy. Her row is still the selected one, her form is
  // still open, and her half-written note is still in it — the restore effect
  // resets the draft on arrival, so arming it here would have wiped exactly
  // this text.
  await expect(vandy).toHaveAttribute("aria-current", "true");
  await expect(page.locator('button[aria-label*="Sokha Phlat"]')).not.toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("textbox").first()).toHaveValue(note);

  // And "Excused · Device or data fault" is not on offer as her reason. It was
  // never a decision about her; it was a statement about a dead card reader.
  // The repeat only renders on a CLOSED flag card, so the form has to be shut
  // to look for it — with it open the button is absent either way and the
  // assertion would prove nothing.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Same reason applies" })).toHaveCount(0);
});

// The band's button starts the largest write on the page, and the `decide`
// mutation behind it is shared with the panel. Two things have to hold at once:
// it must lock while its OWN write runs — a second click issues a second
// mutation, and two needs_confirm responses then race into the same preview —
// and it must stay quiet while the PANEL writes, because an unqualified
// `decide.isPending` would put "Excusing…" on the band every time somebody
// decided a single person, announcing a mass excuse they never asked for.
test("the band's button reports the band's own write, and no other", async ({ page }) => {
  // ≥ lg for the reason the band test above states: this reads the band WHILE
  // the panel's own write is in flight, so both have to be on screen together,
  // which below lg they no longer are.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/method/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("decide_flags")) {
      // Held open on purpose: an in-flight state that is never observed cannot
      // be asserted on, and this whole test is about one.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { ok: true, written: 1, group_key: "AFD-slow", errors: [] } satisfies DecideFlagsResult,
        }),
      });
    }
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: [
            A11Y_OUTAGE,
            ...A11Y_PEOPLE.map((person) => ({ kind: "person", ...person }) satisfies QueueEntry),
          ],
          counts: { ...A11Y_PAYLOAD.counts, people: 5, rows: 4 } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  const band = page.getByRole("region", { name: "Device outages" });
  const bandExcuse = band.getByRole("button", { name: /Excus/ });
  const panelSubmit = page.getByRole("button", { name: /^Excuse\b/ }).last();

  // A panel write, mid-flight.
  await page.locator('button[aria-label*="Vandy In"]').click();
  await page.getByRole("button", { name: "Decide", exact: true }).click();
  await page
    .getByRole("combobox", { name: /reason/i })
    .selectOption({ label: "Approved leave or holiday" });
  await panelSubmit.click();

  // The panel's own submit is disabled while its write runs, which is the proof
  // that the band is being read mid-flight rather than after everything
  // settled.
  await expect(panelSubmit).toBeDisabled();
  // Snapshot reads, NOT `expect(...).toBeEnabled()`. A web-first assertion
  // retries for five seconds, so a negative one about a two-second window
  // passes the moment the window shuts — it would report the band as quiet
  // simply by outlasting the write it was supposed to be watching.
  expect(await bandExcuse.isDisabled()).toBe(false);
  expect(await bandExcuse.textContent()).not.toMatch(/Excusing/);
  await expect(panelSubmit).toBeEnabled({ timeout: 10_000 });

  // The band's own write, mid-flight.
  await bandExcuse.click();
  await expect(bandExcuse).toBeDisabled();
  await expect(bandExcuse).toHaveText(/Excusing/);
});

// `excludedBranches` is keyed by `group_key`, and a branch outage's group_key
// is stable across months — the same fact that makes it unsafe to send as a
// decision's group_key. Left standing across a change of question, a branch
// unchecked for last week's outage silently narrows this week's write, and the
// band is collapsed by default so the only trace is a smaller number inside a
// button label.
test("a branch unchecked for one outage is not still unchecked for the next", async ({ page }) => {
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: [
            A11Y_OUTAGE,
            ...A11Y_PEOPLE.map((person) => ({ kind: "person", ...person }) satisfies QueueEntry),
          ],
          counts: { ...A11Y_PAYLOAD.counts, people: 5, rows: 4 } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  const band = page.getByRole("region", { name: "Device outages" });
  const bandExcuse = band.getByRole("button", { name: /Excuse|Select a branch/ });

  await band.getByRole("button", { name: /Review 1 branch/ }).click();
  await band.getByRole("checkbox", { name: "Include Siem Reap Depot" }).click();
  await expect(bandExcuse).toHaveText("Select a branch to excuse");

  // A different consequence filter is a different question, and the answer to
  // the old one must not be carried into it.
  await page.getByLabel("Consequence").selectOption("routine");
  await expect(bandExcuse).toHaveText(/^Excuse /);
});

// The restore effect remembers a SLOT, because the row it was on is about to
// stop existing. Remembered against the payload rather than against the rendered
// list, the slot vacated by the last person is filled by the outage group — and
// the page opens a decision form over a device fault, which is the single thing
// this layout exists to prevent. `focusKey` then names a row the list never
// renders, so `onFocusHandled` never fires and focus drops to <body>: the exact
// regression the restore effect was built to fix.
test("deciding the last judgment row lands nowhere, not on the outage", async ({ page }) => {
  let decided = false;
  const person = A11Y_PEOPLE[0];
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("decide_flags")) {
      decided = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { ok: true, written: 1, group_key: "AFD-z", errors: [] } satisfies DecideFlagsResult,
        }),
      });
    }
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    // One person and one outage; deciding her leaves the outage alone in the
    // payload and the rendered list empty.
    const entries: QueueEntry[] = decided
      ? [A11Y_OUTAGE]
      : [A11Y_OUTAGE, { kind: "person", ...person } satisfies QueueEntry];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries,
          counts: { ...A11Y_PAYLOAD.counts, people: 3, rows: 2 } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Vandy In"]').click();
  await page.getByRole("button", { name: "Decide", exact: true }).click();
  await page
    .getByRole("combobox", { name: /reason/i })
    .selectOption({ label: "Approved leave or holiday" });
  await page.getByRole("button", { name: /^Excuse\b/ }).last().click();

  await expect(page.locator('button[aria-label*="Vandy In"]')).toHaveCount(0);

  // Nothing is selected, and the panel says so. Landing on the outage would
  // have put its branch, its members and an excuse control in here instead.
  const panel = page.getByRole("region", { name: "Selected flag" });
  await expect(panel.getByText("Pick a row to review")).toBeVisible();
  await expect(panel).not.toContainText("Siem Reap Depot");

  // The outage itself is untouched — still a band, still awaiting its own
  // acknowledgement.
  await expect(page.getByRole("region", { name: "Device outages" })).toBeVisible();
});

test("a second save is announced too, not silently deduplicated", async ({ page }) => {
  // A live region announces on MUTATION. Two identical outcome strings mean
  // React bails out, the DOM never changes, and every save after the first is
  // silent — the exact silence the live region exists to end.
  let decides = 0;
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("decide_flags")) {
      decides += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { ok: true, written: 1, group_key: `AFD-${decides}`, errors: [] } satisfies DecideFlagsResult,
        }),
      });
    }
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    const remaining = A11Y_PEOPLE.slice(decides);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: remaining.map((person) => ({ kind: "person", ...person })),
          counts: {
            ...A11Y_PAYLOAD.counts,
            open: remaining.length,
            people: remaining.length,
            rows: remaining.length,
          } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  const live = page.locator('[role="status"][aria-live="polite"]');
  await page.goto("/hr-flags");

  async function decideSelected() {
    await page.getByRole("button", { name: "Decide", exact: true }).click();
    await page
      .getByRole("combobox", { name: /reason/i })
      .selectOption({ label: "Approved leave or holiday" });
    await page.getByRole("button", { name: /^Excuse\b/ }).last().click();
  }

  await page.locator('button[aria-label*="Vandy In"]').click();
  await decideSelected();
  await expect(live).toHaveText(/saved/i);
  const first = await live.textContent();

  await decideSelected(); // we were landed on the next row already
  // Selection, not focus, and deliberately still running on a phone: the live
  // region this test is about is rendered TWICE — once in the split branch and
  // once in the modal branch — so pinning this to >= lg would leave the second
  // copy, the newer one, asserted by nothing. Focus below lg stays inside the
  // sheet by design; "after a phone write, focus does not land behind the
  // sheet" is where that belongs.
  await expect(page.locator('button[aria-label*="Dara Kim"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  // Same words, different text node — otherwise nothing is announced at all.
  await expect(live).toHaveText(/saved/i);
  expect(await live.textContent()).not.toBe(first);
});

// `outageExcuseLabel` takes `coveredPeopleCount` for exactly one reason: the
// button's number must fall as branches are unchecked, not just switch between
// "everything" (`:1428` covers the all-unchecked floor, "Select a branch to
// excuse") and "nothing left". Two branches here, so unchecking ONE still
// leaves the other counted — the countdown itself, never exercised until now.
test("unchecking a branch takes its people out of the excuse", async ({ page }) => {
  const queuePayload = {
    entries: [
      {
        kind: "group",
        group_type: "BRANCH_NO_DEVICE_DATA",
        group_key: "BRANCH_NO_DEVICE_DATA:DIS Iconic",
        branch: "DIS Iconic",
        flag_code: null,
        attendance_date: null,
        dates: ["2026-08-03", "2026-08-04"],
        day_count: 2,
        rank: 134,
        tier: "act",
        members: [
          {
            entry_key: "BRANCH_NO_DEVICE_DATA:DIS Iconic|p:DI-1",
            employee: "DI-1",
            employee_name: "Ada Lovelace",
            employee_branch: "DIS Iconic",
            employee_image: null,
            attendance_date: "2026-08-03",
            dates: ["2026-08-03"],
            rank: 134,
            tier: "act",
            flags: [
              {
                flag_identity: "f-outage-1",
                flag_code: "MISSING_TIME",
                attendance_date: "2026-08-03",
                day_closed: 1,
                evidence: { minutes: 240 },
                rank: 134,
                tier: "act",
                decision_state: "undecided",
                decision: null,
              } satisfies FlagOut,
            ],
            undecided_count: 1,
            also_count: 0,
            also_outlier_count: 0,
          } satisfies QueuePerson,
        ],
      },
      {
        kind: "group",
        group_type: "BRANCH_NO_DEVICE_DATA",
        group_key: "BRANCH_NO_DEVICE_DATA:ISBB",
        branch: "ISBB",
        flag_code: null,
        attendance_date: null,
        dates: ["2026-08-03"],
        day_count: 1,
        rank: 134,
        tier: "act",
        members: [
          {
            entry_key: "BRANCH_NO_DEVICE_DATA:ISBB|p:DI-2",
            employee: "DI-2",
            employee_name: "Grace Hopper",
            employee_branch: "ISBB",
            employee_image: null,
            attendance_date: "2026-08-03",
            dates: ["2026-08-03"],
            rank: 134,
            tier: "act",
            flags: [
              {
                flag_identity: "f-outage-2",
                flag_code: "MISSING_TIME",
                attendance_date: "2026-08-03",
                day_closed: 1,
                evidence: { minutes: 210 },
                rank: 134,
                tier: "act",
                decision_state: "undecided",
                decision: null,
              } satisfies FlagOut,
            ],
            undecided_count: 1,
            also_count: 0,
            also_outlier_count: 0,
          } satisfies QueuePerson,
        ],
      },
    ] satisfies QueueEntry[],
    counts: { open: 2, needs_re_review: 0, decided: 0, people: 2, rows: 2, open_capped: false },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    outage_dates: [
      { branch: "DIS Iconic", date: "2026-08-03" },
      { branch: "DIS Iconic", date: "2026-08-04" },
      { branch: "ISBB", date: "2026-08-03" },
    ],
    truncated: false,
    start_date: "2026-07-26",
    end_date: "2026-08-08",
  } satisfies QueuePayload;

  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: queuePayload }),
    });
  });

  await page.goto("/hr-flags");
  const band = page.getByRole("region", { name: "Device outages" });
  await band.getByRole("button", { name: /^Review 2/ }).click();

  const bandExcuse = band.getByRole("button", { name: /Excuse|Select a branch/ });
  await expect(bandExcuse).toHaveText("Excuse 2 people · 2 flags");

  await band.getByRole("checkbox", { name: "Include ISBB" }).click();

  // Ada's branch is still checked, so the count falls to her alone — not to
  // zero, and not to the "nothing left" floor — and singularises at 1.
  await expect(bandExcuse).toHaveText("Excuse 1 person · 1 flag");
});

// `A11Y_PAYLOAD` (used by every roving-tabindex test above) carries no outage,
// so those tests have only ever proven the keyboard model on a healthy day.
// The band mounts two extra focusable controls (its disclosure and its Excuse
// button) ABOVE the list; this proves the roving tabindex and the arrow-key
// model still hold with both of them present, and that they stay scoped to
// the list rather than reaching up into the band.
test("the keyboard model survives the band", async ({ page }) => {
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: [
            A11Y_OUTAGE,
            ...A11Y_PEOPLE.map((person) => ({ kind: "person", ...person }) satisfies QueueEntry),
          ],
          counts: { ...A11Y_PAYLOAD.counts, people: 5, rows: 4 } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  const band = page.getByRole("region", { name: "Device outages" });
  await expect(band).toBeVisible();

  const list = page.getByRole("list", { name: "Flag queue" });
  const rows = list.getByRole("button");
  await expect(rows).toHaveCount(3);

  // aria-setsize counts only the judgment rows the list actually holds — the
  // outage was already partitioned out before FlagQueueList ever saw it — so
  // it must read 3, not 4.
  await expect(list.getByRole("listitem").first()).toHaveAttribute("aria-setsize", "3");

  // Roving tabindex: exactly one row is tabbable, scoped to the list — the
  // band's own disclosure and Excuse button are real tab stops of their own
  // and must not be counted here.
  await expect(list.locator('button[tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('button[aria-label*="Vandy In"]')).toHaveAttribute("tabindex", "0");

  // The arrows move within the list only, clamped at the last row rather than
  // escaping upward into the band's controls.
  await page.locator('button[aria-label*="Vandy In"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('button[aria-label*="Sokha Phlat"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('button[aria-label*="Dara Kim"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('button[aria-label*="Dara Kim"]')).toBeFocused();
  await expect(band.getByRole("button", { name: /Review 1 branch/ })).not.toBeFocused();
});

/** One person, four mornings — a compressed list small enough to count by eye. */
const MANY_FLAG_PERSON = {
  entry_key: "p:HR-EMP-00041",
  employee: "HR-EMP-00041",
  employee_name: "Sopheak Chan",
  employee_branch: "Siem Reap Depot",
  employee_image: null,
  attendance_date: "2026-08-10",
  dates: ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"],
  rank: 134,
  tier: "act",
  flags: ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"].map((date, index) => ({
    flag_identity: `MANY-${index}`,
    flag_code: "MISSING_TIME",
    attendance_date: date,
    severity: "WARNING",
    day_closed: 1,
    evidence: { minutes: 240 - index * 10 },
    rank: 134,
    tier: "act",
    decision_state: "undecided",
    decision: null,
  })) satisfies FlagOut[],
  undecided_count: 4,
  also_count: 0,
  also_outlier_count: 0,
} satisfies QueuePerson;

test("a many-flag person shows one card and the rest compressed, and any of them opens", async ({
  page,
}) => {
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: [{ kind: "person", ...MANY_FLAG_PERSON }] satisfies QueueEntry[],
          counts: {
            ...A11Y_PAYLOAD.counts,
            open: 4,
            people: 1,
            rows: 1,
          } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Sopheak Chan"]').click();

  const cards = page.locator('[data-slot="flag-card"]');
  const compressed = page.locator('[data-slot="flag-one-liner"]');
  await expect(cards).toHaveCount(1);
  await expect(compressed).toHaveCount(3);

  // The click path the unit suite cannot reach: the middle one, so neither
  // "always the first" nor "always the last" would satisfy this.
  await compressed.nth(1).click();
  await expect(cards).toHaveCount(2);
  await expect(compressed).toHaveCount(2);
});

// The pin, which is a geometric claim and therefore cannot live in the unit
// suite (Global Constraint 7: renderToStaticMarkup + regex, no layout). The
// unit test beside this one asserts only that a body and a footer EXIST and
// carry the right utilities — it stays green if the footer is nested back
// inside the body, which is exactly what a careless refactor produces. This is
// the test that catches that, so it must assert both halves:
//
//   1. the footer's box does not move while the body scrolls, and
//   2. something that was below the fold is now above it.
//
// (1) alone passes for a footer that merely exists above an unscrollable body.
// (2) is what makes it a pin rather than a static bar.
test("the decision footer stays put while the evidence scrolls behind it", async ({ page }) => {
  // Explicitly short and explicitly ≥ lg. The pin is an lg-only layout — below
  // that breakpoint the panel has no bounded height and the whole column
  // scrolls as one — and the four-flag fixture does not overflow a tall
  // window. Set here rather than at project level so this runs identically in
  // both the desktop and mobile projects.
  await page.setViewportSize({ width: 1280, height: 460 });
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: [{ kind: "person", ...MANY_FLAG_PERSON }] satisfies QueueEntry[],
          counts: {
            ...A11Y_PAYLOAD.counts,
            open: 4,
            people: 1,
            rows: 1,
          } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Sopheak Chan"]').click();

  const body = page.locator('[data-slot="decision-body"]');
  const footer = page.locator('[data-slot="decision-footer"]');
  await expect(footer).toBeVisible();

  // Asserted, not assumed: if the fixture or the card ever shrinks enough to
  // fit, everything below would pass vacuously and prove nothing.
  const overflow = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow, "the body must have more evidence than fits, or this proves nothing").toBeGreaterThan(40);

  const lastOneLiner = page.locator('[data-slot="flag-one-liner"]').last();
  const footerBefore = await footer.boundingBox();
  const evidenceBefore = await lastOneLiner.boundingBox();

  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(40);

  const footerAfter = await footer.boundingBox();
  const evidenceAfter = await lastOneLiner.boundingBox();

  // 1. The footer did not move, in either position or size.
  expect(footerAfter?.y).toBeCloseTo(footerBefore?.y ?? -1, 0);
  expect(footerAfter?.height).toBeCloseTo(footerBefore?.height ?? -1, 0);
  // 2. The evidence did — it travelled up, behind the footer that did not.
  expect(evidenceAfter?.y ?? 0).toBeLessThan(evidenceBefore?.y ?? 0);

  // And the footer's bottom edge is the panel column's bottom edge, which is
  // what "pinned" means here. A footer merely sitting last in a scrolled body
  // would satisfy neither this nor (1).
  const panel = page.getByRole("region", { name: "Selected flag" });
  const panelBox = await panel.boundingBox();
  expect((footerAfter?.y ?? 0) + (footerAfter?.height ?? 0)).toBeCloseTo(
    (panelBox?.y ?? 0) + (panelBox?.height ?? 0),
    0,
  );
});

/** Six people on one routine code — a group footer tall enough to matter. */
const CAP_GROUP_MEMBERS = Array.from({ length: 6 }, (_, i) => ({
  entry_key: `ROUTINE_CODE:LATE_START|p:HR-EMP-2000${i}`,
  employee: `HR-EMP-2000${i}`,
  employee_name: `Capped Member ${i + 1}`,
  employee_branch: "Siem Reap Depot",
  employee_image: null,
  attendance_date: "2026-08-12",
  dates: ["2026-08-12"],
  rank: 20,
  tier: "routine",
  flags: [
    {
      flag_identity: `CAP-${i}`,
      flag_code: "LATE_START",
      attendance_date: "2026-08-12",
      severity: "WARNING",
      day_closed: 1,
      evidence: { minutes: 12 + i },
      rank: 20,
      tier: "routine",
      decision_state: "undecided",
      decision: null,
    },
  ] satisfies FlagOut[],
  undecided_count: 1,
  also_count: 0,
  also_outlier_count: 0,
})) satisfies QueuePerson[];

const CAP_GROUP = {
  kind: "group",
  group_type: "ROUTINE_CODE",
  group_key: "ROUTINE_CODE:LATE_START",
  branch: null,
  flag_code: "LATE_START",
  attendance_date: "2026-08-12",
  dates: ["2026-08-12"],
  day_count: 1,
  rank: 20,
  tier: "routine",
  members: CAP_GROUP_MEMBERS,
} satisfies QueueEntry;

/**
 * The footer's height cap, checked geometrically because that is the only way
 * it CAN be checked — a unit assertion here could only read the class string
 * back, which proves the class is present and nothing about whether it binds.
 *
 * Both modes, deliberately. The person footer is 61px closed and only grows
 * past the cap once its form opens; the group's is ~285px before anything is
 * touched, which is the case that motivated the cap and the one that shipped
 * without it.
 */
async function assertFooterCapHoldsAndSubmitIsReachable(
  page: import("@playwright/test").Page,
) {
  const footer = page.locator('[data-slot="decision-footer"]');
  const panel = page.getByRole("region", { name: "Selected flag" });
  await expect(footer).toBeVisible();

  const panelBox = await panel.boundingBox();
  const limit = (panelBox?.height ?? 0) * 0.7;

  // Precondition, in the same spirit as the pin test's overflow check: the
  // footer's CONTENT must want more than the cap allows, or the cap was never
  // going to engage at this viewport and everything below passes vacuously.
  const wanted = await footer.evaluate((el) => el.scrollHeight);
  expect(
    wanted,
    "the uncapped footer must exceed 70% of the panel, or this proves nothing",
  ).toBeGreaterThan(limit + 1);

  // The cap binds …
  const footerBox = await footer.boundingBox();
  expect(footerBox?.height ?? 0).toBeLessThanOrEqual(limit + 1);
  // … the body keeps a real share rather than collapsing to nothing …
  const body = page.locator('[data-slot="decision-body"]');
  expect((await body.boundingBox())?.height ?? 0).toBeGreaterThan(1);
  // … and the write is still reachable, which is the whole point: `shrink-0`
  // with no cap and no overflow strands it off the bottom of a short window.
  const submit = footer.locator('[data-slot="button"]').filter({ hasText: "Excuse" });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
}

test("a short window cannot strand the submit button — person", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 430 });
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: [{ kind: "person", ...MANY_FLAG_PERSON }] satisfies QueueEntry[],
          counts: {
            ...A11Y_PAYLOAD.counts,
            open: 4,
            people: 1,
            rows: 1,
          } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Sopheak Chan"]').click();
  // A person's footer only outgrows the cap once the form is open — which is
  // the state HR is in for the whole of every decision.
  await page
    .locator('[data-slot="decision-footer"]')
    .getByRole("button", { name: "Decide", exact: true })
    .click();
  await expect(page.getByRole("group", { name: "Outcome" })).toBeVisible();

  await assertFooterCapHoldsAndSubmitIsReachable(page);
});

test("a short window cannot strand the submit button — group", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 430 });
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: [CAP_GROUP] satisfies QueueEntry[],
          counts: {
            ...A11Y_PAYLOAD.counts,
            open: 6,
            people: 6,
            rows: 1,
          } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator("button[aria-label]").filter({ hasText: "6 people" }).first().click();
  // Nothing is opened first: a group's form is always armed, so its footer is
  // over the cap from the moment the row is selected.
  await assertFooterCapHoldsAndSubmitIsReachable(page);
  // The safeguard list is what the body must not lose. Without the cap the
  // body collapses and this becomes unreachable in front of a bulk excuse.
  const covers = page.getByText("Who this covers");
  await covers.scrollIntoViewIfNeeded();
  await expect(covers).toBeInViewport();
});

// ---------------------------------------------------------------------------
// Below lg the panel is a modal, not a column below the list.
//
// The viewport is set inside each test rather than left to the project, for the
// same reason the pin test above states: `desktop` is 1280 wide, so without it
// these would pass in `mobile` and fail in `desktop`. The width also pins WHICH
// surface opens — ResponsiveModal picks its own with useIsMobile() at 768, so
// under 768 it is the bottom Sheet, and the 768–1023px band gets the Dialog leg
// instead. Neither project's own viewport lands in that band (`mobile` is a
// Pixel 7 at 412, `desktop` is 1280), so the last test in this section sets 900
// explicitly and is the only thing that exercises the Dialog leg at all.
// ---------------------------------------------------------------------------
const PHONE_VIEWPORT = { width: 412, height: 915 };

/** The same phone on a shorter screen, so the sheet's own cap actually bites.
 *  The pin above it needed the same treatment for the same reason: the
 *  four-flag fixture does not overflow a tall window, and a pin proves nothing
 *  in a container that never scrolled. */
const SHORT_PHONE_VIEWPORT = { width: 412, height: 480 };

/** Inside ResponsiveModal's Dialog band (>= 768 so it is not the Sheet, < 1024
 *  so it is not the split), and short for the same reason the phone one is:
 *  a pin proves nothing in a container that never scrolled. */
const TABLET_VIEWPORT = { width: 900, height: 500 };

/**
 * The surface animates in over ~200ms — the sheet slides up from entirely below
 * the fold, the dialog zooms — and a box read mid-animation measures the
 * animation, not the layout. Measured here, the "pinned" footer appeared to
 * move 97px purely because the two reads landed on different frames.
 *
 * Both legs of ResponsiveModal are `role="dialog"`, so this covers both.
 */
async function modalHasFinishedOpening(page: import("@playwright/test").Page) {
  await page
    .getByRole("dialog")
    .evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
}

test("on a phone the decision comes to you, and the list keeps its place", async ({ page }) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: A11Y_PAYLOAD }),
    });
  });

  await page.goto("/hr-flags");

  const list = page.getByRole("list", { name: "Flag queue" });
  await list.getByRole("button").first().click();

  // The decision is on screen without scrolling — today the panel is a sibling
  // AFTER the full list, so on the real queue it sits 9,146px below the tap.
  // The pinned footer is what has to be reachable: the Outcome group does not
  // exist until the form is opened, which is Task 9's deliberate un-arming.
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-slot="decision-footer"]')).toBeInViewport();

  await sheet.getByRole("button", { name: "Decide", exact: true }).click();
  await expect(sheet.getByRole("group", { name: "Outcome" })).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(list.getByRole("button").first()).toBeVisible();
});

test("the footer stays pinned inside the sheet, not just inside the split", async ({ page }) => {
  // Task 9 proved the pin against the desktop panel column. The sheet is a
  // different container — `max-h-[min(85dvh,42rem)]` with its own scroller —
  // and `h-full` resolving against a flex-sized parent is exactly where a pin
  // silently degrades into "the whole thing scrolls as one".
  await page.setViewportSize(SHORT_PHONE_VIEWPORT);
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: [{ kind: "person", ...MANY_FLAG_PERSON }] satisfies QueueEntry[],
          counts: { ...A11Y_PAYLOAD.counts, open: 4, people: 1, rows: 1 } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Sopheak Chan"]').click();

  await modalHasFinishedOpening(page);
  const footer = page.getByRole("dialog").locator('[data-slot="decision-footer"]');
  const before = await footer.boundingBox();

  const body = page.getByRole("dialog").locator('[data-slot="decision-body"]');
  // Asserted, not assumed, exactly as the desktop pin test asserts it: if the
  // fixture ever fits inside the sheet, nothing below scrolls and both
  // assertions pass while proving nothing about a pin.
  const overflow = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow, "the sheet's body must hold more than fits, or this proves nothing").toBeGreaterThan(40);
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));

  // Byte-identical, and something that was below the fold is now above it —
  // the second half is what distinguishes a pinned footer from a static one
  // in a container that never scrolled at all.
  expect(await footer.boundingBox()).toEqual(before);
  await expect(page.locator('[data-slot="flag-one-liner"]').last()).toBeInViewport();
});

test("after a phone write, focus does not land behind the sheet", async ({ page }) => {
  // The post-write restore hands focus to the next row, which is the right
  // answer beside the split and the wrong one under a modal: Radix marks
  // everything behind the sheet `aria-hidden="true"`, so focusing that row puts
  // the keyboard on an element the accessibility tree says does not exist,
  // while the sheet in front announces the very same person. Measured before
  // the fix: activeElement was the "Sokha Phlat" row button, insideAriaHidden
  // true, insideDialog false, dialog open and titled "Sokha Phlat".
  await page.setViewportSize(PHONE_VIEWPORT);
  let decided = false;
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("decide_flags")) {
      decided = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { ok: true, written: 1, group_key: "AFD-f", errors: [] } satisfies DecideFlagsResult,
        }),
      });
    }
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    const remaining = decided ? A11Y_PEOPLE.slice(1) : A11Y_PEOPLE;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: remaining.map((person) => ({ kind: "person", ...person })) satisfies QueueEntry[],
          counts: {
            ...A11Y_PAYLOAD.counts,
            open: remaining.length,
            people: remaining.length,
            rows: remaining.length,
          } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Vandy In"]').click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Decide", exact: true }).click();
  await page.getByRole("combobox", { name: /reason/i }).selectOption({ label: "Approved leave or holiday" });
  await page.getByRole("button", { name: /^Excuse\b/ }).last().click();

  // The write landed and the sheet moved on to the next person.
  await expect(page.locator('button[aria-label*="Vandy In"]')).toHaveCount(0);
  await expect(sheet).toBeVisible();

  // Asserted, not assumed: if nothing is aria-hidden the premise is gone and
  // this test proves nothing, so fail loudly rather than pass on an empty set.
  const hiddenCount = await page.locator('[aria-hidden="true"]').count();
  expect(hiddenCount, "the sheet must hide the page behind it, or this proves nothing").toBeGreaterThan(0);

  const focus = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      insideAriaHidden: el?.closest('[aria-hidden="true"]') != null,
      insideDialog: el?.closest('[role="dialog"]') != null,
    };
  });
  expect(focus.insideAriaHidden).toBe(false);
  expect(focus.insideDialog).toBe(true);
});

/**
 * The 768–1023px band — the one surface on this page with no automated cover
 * until now.
 *
 * `useIsBelowLg` (1024) opens the modal and `useIsMobile` (768) picks which one,
 * so this band gets ResponsiveModal's DIALOG leg while every test above gets
 * either the split (>= 1024) or the Sheet (< 768). It is a different container
 * again: a centred, `sm:max-w-2xl`, `max-h-[min(85dvh,42rem)]` box rather than a
 * full-width sheet anchored to the bottom edge, and `h-full` resolving against a
 * differently-sized parent is exactly where a pin degrades into "the whole thing
 * scrolls as one". Checked by hand once at 900px; this is the version that stays
 * checked.
 */
test("in the tablet band the decision opens as a dialog, and its footer is pinned too", async ({
  page,
}) => {
  await page.setViewportSize(TABLET_VIEWPORT);
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          ...A11Y_PAYLOAD,
          entries: [{ kind: "person", ...MANY_FLAG_PERSON }] satisfies QueueEntry[],
          counts: { ...A11Y_PAYLOAD.counts, open: 4, people: 1, rows: 1 } satisfies QueuePayload["counts"],
        },
      }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Sopheak Chan"]').click();

  // A dialog opened on selection — and it is the Dialog leg, not the Sheet.
  // Without the second half this test would pass unchanged at 412px and prove
  // nothing about the band it is named for.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);

  await modalHasFinishedOpening(page);
  const footer = dialog.locator('[data-slot="decision-footer"]');
  const before = await footer.boundingBox();

  const body = dialog.locator('[data-slot="decision-body"]');
  // Asserted, not assumed, as both pin tests above assert it: if the fixture
  // ever fits inside the dialog, nothing below scrolls and both assertions pass
  // while proving nothing about a pin.
  const overflow = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow, "the dialog's body must hold more than fits, or this proves nothing").toBeGreaterThan(40);
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(40);

  // Byte-identical, and something that was below the fold is now above it —
  // the second half is what distinguishes a pinned footer from a static one in
  // a container that never scrolled at all.
  expect(await footer.boundingBox()).toEqual(before);
  await expect(page.locator('[data-slot="flag-one-liner"]').last()).toBeInViewport();
});

/**
 * ResponsiveModal is shared with eight other callers, and 89f6cf07 changed it
 * from this branch without a test: it now passes `aria-describedby={undefined}`
 * when it has no `description`, so Radix stops pointing at a description
 * element that never renders.
 *
 * This is an e2e and not a unit test on purpose. Radix's Portal renders `null`
 * until its mount effect runs, so `renderToStaticMarkup` emits nothing at all
 * for an open modal — an assertion there would pass by looking for markup that
 * was never produced. ResponsiveModal.test.tsx pins exactly that.
 *
 * Both halves, because either alone is worthless: the negative would also pass
 * on a modal that failed to open, and the positive would also pass on a build
 * that emitted the attribute unconditionally.
 */
test("a modal with no description does not claim to have one", async ({ page }) => {
  // 900: ResponsiveModal's Dialog leg, and the page's two callers are both
  // reachable from here — the panel modal passes no `description`, the
  // over-threshold confirm modal passes one.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("decide_flags")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          // The backend refuses more than 25 writes without an explicit
          // confirm; that refusal is what opens the described modal.
          message: {
            needs_confirm: true,
            preview: { count: 30, employees: 12 },
          } satisfies DecideFlagsResult,
        }),
      });
    }
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: A11Y_PAYLOAD }),
    });
  });

  await page.goto("/hr-flags");
  await page.locator('button[aria-label*="Vandy In"]').click();

  // Negative control: no `description` prop, so no attribute at all. Before
  // 89f6cf07 this was Radix's own generated id pointing at nothing.
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  expect(
    await panel.getAttribute("aria-describedby"),
    "a modal with no description must not point at one",
  ).toBeNull();

  // Positive control: the confirm modal DOES pass a description, so the
  // attribute must be there and must resolve.
  await panel.getByRole("button", { name: "Decide", exact: true }).click();
  await page
    .getByRole("combobox", { name: /reason/i })
    .selectOption({ label: "Approved leave or holiday" });
  await page.getByRole("button", { name: /^Excuse\b/ }).last().click();

  const confirm = page.getByRole("dialog", { name: "Confirm this decision" });
  await expect(confirm).toBeVisible();
  // Resolved through the DOM rather than compared as a string: the whole defect
  // was an id that existed on the attribute and nowhere else, which any
  // assertion on the attribute's own value would have passed.
  const described = await confirm.evaluate((el) => {
    const id = el.getAttribute("aria-describedby");
    return id === null ? null : { text: document.getElementById(id)?.textContent ?? null };
  });
  expect(described, "a modal WITH a description must carry the attribute").not.toBeNull();
  expect(described?.text, "and it must resolve to an element that exists").toBe(
    "30 flags across 12 employees",
  );
});

// ---------------------------------------------------------------------------
// The list column's width, which nothing else pins.
//
// This branch dropped the page's max-w-7xl cap to reclaim ~300px at 1512, and
// the spec's Decision 4 spends it on the list: "width converts directly into
// rows that stop truncating". It very nearly did not. The grid ceiling was
// byte-identical to the branch point until the final review caught it, and the
// first fix was a MEASURED NO-OP — Tailwind v4 emits every arbitrary min-width
// variant as one group BEFORE the named breakpoints rather than interleaving
// them by width, so `min-[1374px]:` lost the cascade to `lg:` and the list
// stayed 480px at 1920. Both ceilings are arbitrary variants now, so they sort
// by value.
//
// Two viewports on purpose. One would prove the list is wide somewhere; the
// pair proves the BREAKPOINT is where it is — deleting the class fails the
// first, making 40rem unconditional fails the second. 1374 = 640 + 12 + 658 +
// 64: the width at which the panel first reaches its own 62ch cap, so nothing
// narrows at any width below it.
// ---------------------------------------------------------------------------
test("above 1374 the list gets the width the page reclaimed, and not below it", async ({
  page,
}) => {
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: A11Y_PAYLOAD }),
    });
  });

  await page.goto("/hr-flags");
  const list = page.getByRole("list", { name: "Flag queue" });

  // Below the step: the 30rem ceiling, unchanged from before this branch.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(list).toBeVisible();
  const narrow = (await list.boundingBox())!.width;
  expect(narrow, "at 1280 the list keeps the 30rem ceiling").toBeLessThan(520);

  // Above it: 40rem, which is where the reclaimed width finally lands.
  await page.setViewportSize({ width: 1512, height: 900 });
  const wide = (await list.boundingBox())!.width;
  expect(wide, "at 1512 the list takes the 40rem ceiling").toBeGreaterThan(560);
});

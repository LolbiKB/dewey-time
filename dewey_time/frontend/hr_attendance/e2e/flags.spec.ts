import { test, expect } from "@playwright/test";
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

// Every payload below is hand-built, and nothing type-checks it: tsconfig's
// `include` is `["src"]`, and Playwright transpiles without checking. So these
// literals have to be kept honest by hand against `src/types/flags.ts` and
// `flag_grouping.build_queue`, which is the ONLY thing standing between this
// file and a fixture that passes while production throws. In particular each
// person carries `entry_key` (`p:<employee>`, or `<group_key>|p:<employee>` for
// a group member), `dates` (its flags' distinct dates, ascending),
// `also_count`/`also_outlier_count`, every flag carries its own
// `attendance_date`, and `counts` carries `rows` (the entry count the header
// prints). Derive them from the fixture's own flags rather than stubbing them
// out — a fixture that disagrees with the backend proves nothing.

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
        rank: 140,
        tier: "act",
        members: [
          {
            entry_key: "grp-device-siem-reap-2026-08-13|p:EMP-301",
            employee: "EMP-301",
            employee_name: "Thida Sok",
            employee_branch: "Siem Reap Depot",
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
        rank: 20,
        tier: "routine",
        members: [
          {
            entry_key: "grp-routine-LATE_START-2026-08-14|p:EMP-401",
            employee: "EMP-401",
            employee_name: "Leng Ratha",
            employee_branch: "BRANCH-A",
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
    // `rows` is the number of entries, `people` the number of distinct
    // employees who still owe HR an answer (build_queue) — three entries here,
    // five people across them.
    counts: { open: 6, needs_re_review: 1, decided: 2, people: 5, rows: 3 },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  };

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

  // BRANCH_NO_DEVICE_DATA group: the design doc's cause-grouping rule 1
  // requires the branch name in the copy and explicitly forbids a device
  // serial — "Siem Reap Depot" is therefore guaranteed to appear somewhere in
  // this group's card.
  await expect(page.getByText(/Siem Reap Depot/).first()).toBeVisible();

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
  // CountChip (FlagQueuePage.tsx) renders `{label}<span>{value}</span>` with no
  // whitespace between the JSX expression and the following element, so the
  // chip's real DOM text content is "Open6" / "Decided2" — a trailing `\b`
  // fails between a letter and a digit. Anchor at the start instead; a
  // trailing `\b` is unnecessary once the match is anchored to the chip's own
  // label prefix.
  await expect(page.getByText(/^Open/)).toBeVisible();
  await expect(page.getByText(/needs re-review/i)).toBeVisible();
  await expect(page.getByText(/^Decided/)).toBeVisible();
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
  const undecidedFlag = {
    flag_identity: FLAG_IDENTITY,
    flag_code: "LATE_START",
    attendance_date: "2026-08-13",
    severity: "WARNING",
    day_closed: 1,
    evidence: { minutes: 75 },
    rank: 65,
    tier: "review",
    decision_state: "undecided",
    decision: null,
  };
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
  };

  function personEntry(flag: typeof undecidedFlag, undecidedCount: number) {
    return {
      kind: "person",
      // A lone row, so `p:<employee>` with no group prefix — and one flag on
      // one day, so `dates` is that flag's date.
      entry_key: "p:EMP-201",
      employee: "EMP-201",
      employee_name: "Noor Aziz",
      employee_branch: "BRANCH-A",
      attendance_date: flag.attendance_date,
      dates: [flag.attendance_date],
      rank: 65,
      tier: "review",
      flags: [flag],
      undecided_count: undecidedCount,
      also_count: 0,
      also_outlier_count: 0,
    };
  }

  const basePayload = {
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  };

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
      // One entry either way, so `rows` is 1 in both. `people` counts only
      // those who still owe HR an answer, so it drops to 0 once the single
      // flag is decided (build_queue's `undecided_count` filter).
      const payload =
        queueCalls === 1
          ? { ...basePayload, entries: [personEntry(undecidedFlag, 1)], counts: { open: 1, needs_re_review: 0, decided: 0, people: 1, rows: 1 } }
          : { ...basePayload, entries: [personEntry(decidedFlag, 0)], counts: { open: 0, needs_re_review: 0, decided: 1, people: 0, rows: 1 } };
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
          message: { ok: true, written: 1, group_key: "grp-single-0001", errors: [] },
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

  function memberFlag(n: number) {
    return {
      flag_identity: `AUTO-EMP-5${n}-2026-08-14-late_start`,
      flag_code: "LATE_START",
      attendance_date: "2026-08-14",
      severity: "WARNING",
      day_closed: 1,
      evidence: { minutes: 15 + n },
      rank: 20,
      tier: "routine",
      decision_state: "undecided",
      decision: null,
    };
  }

  function member(n: number, name: string) {
    const flag = memberFlag(n);
    return {
      // A group member, so the key is the group's own key plus the person —
      // the same employee in a second entry would otherwise collide.
      entry_key: `${GROUP_KEY}|p:EMP-5${n}`,
      employee: `EMP-5${n}`,
      employee_name: name,
      employee_branch: "BRANCH-A",
      attendance_date: flag.attendance_date,
      dates: [flag.attendance_date],
      rank: 20,
      tier: "routine",
      flags: [flag],
      undecided_count: 1,
      also_count: 0,
      also_outlier_count: 0,
    };
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
        attendance_date: "2026-08-14",
        rank: 20,
        tier: "routine",
        members,
      },
    ],
    // Five people, but one entry: the group IS the row.
    counts: { open: 5, needs_re_review: 0, decided: 0, people: 5, rows: 1 },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  };

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
          },
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
  const decidedFlag = {
    flag_identity: FLAG_IDENTITY,
    flag_code: "LATE_START",
    attendance_date: "2026-08-13",
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
  };

  const settledPerson = {
    kind: "person",
    entry_key: "p:EMP-201",
    employee: "EMP-201",
    employee_name: "Noor Aziz",
    employee_branch: "BRANCH-A",
    attendance_date: decidedFlag.attendance_date,
    dates: [decidedFlag.attendance_date],
    // A settled person ranks 0: rank comes from the worst UNRESOLVED flag and
    // they have none (flag_grouping._person).
    rank: 0,
    tier: "routine",
    flags: [decidedFlag],
    undecided_count: 0,
    also_count: 0,
    also_outlier_count: 0,
  };

  const basePayload = {
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  };

  const queueParams: (string | null)[] = [];

  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (p.includes("get_flag_queue")) {
      const includeDecided = url.searchParams.get("include_decided");
      queueParams.push(includeDecided);
      // The default view genuinely does not contain this person — which is
      // the entire reason the toggle has to exist.
      const entries = includeDecided ? [settledPerson] : [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: {
            ...basePayload,
            entries,
            // `rows` is the entry count, so it moves with `entries`; `people`
            // stays 0 either way because this person owes HR nothing.
            counts: {
              open: 0,
              needs_re_review: 0,
              decided: 1,
              people: 0,
              rows: entries.length,
            },
          },
        }),
      });
    }

    if (p.includes("decide_flags")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { ok: true, written: 1, group_key: "grp-single-0002", errors: [] },
        }),
      });
    }

    return route.fallback();
  });

  await page.goto("/hr-flags");
  await expect(page.getByText("Nothing to triage in this range.")).toBeVisible();
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

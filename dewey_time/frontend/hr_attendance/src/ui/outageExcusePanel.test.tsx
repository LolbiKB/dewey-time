import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { OUTAGE_CEILING_NOTE } from "@/lib/flagQueueLabels";
import type { OutageGroup } from "@/lib/flagQueuePartition";
import type { DecisionState, FlagOut, QueuePerson } from "@/types/flags";
import { MemoryRouter } from "react-router-dom";

import { OutageExcusePanel, type OutageExcusePanelProps } from "@/ui/OutageExcusePanel";

function flag(identity: string, state: DecisionState = "undecided"): FlagOut {
  return {
    flag_identity: identity,
    flag_code: "MISSING_TIME",
    attendance_date: "2026-08-03",
    day_closed: 1,
    evidence: {},
    rank: 134,
    tier: "act",
    decision_state: state,
    decision: null,
  };
}

function member(employee: string, flags: FlagOut[]): QueuePerson {
  return {
    entry_key: `p:${employee}`,
    employee,
    employee_name: employee,
    employee_branch: "DIS Iconic",
    employee_image: null,
    attendance_date: "2026-08-03",
    dates: ["2026-08-03"],
    rank: 134,
    tier: "act",
    flags,
    undecided_count: flags.length,
    also_count: 0,
    also_outlier_count: 0,
  };
}

function group(branch: string, members: QueuePerson[], dates = ["2026-08-03"]): OutageGroup {
  return {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: `BRANCH_NO_DEVICE_DATA:${branch}`,
    branch,
    flag_code: null,
    attendance_date: null,
    dates,
    day_count: dates.length,
    rank: 134,
    tier: "act",
    members,
  };
}

// MemoryRouter because the ceiling note renders a <Link>, which throws outside
// a router. It still emits href="/hr-attendance", so the assertion is unchanged.
function render(overrides: Partial<OutageExcusePanelProps> = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
    <OutageExcusePanel
      outages={[
        group("DIS Iconic", [member("DI-1", [flag("a")]), member("DI-2", [flag("b")])]),
        group("ISBB", [member("DI-3", [flag("c")])]),
      ]}
      excludedBranches={new Set()}
      onToggleBranch={() => {}}
      onExcuse={() => {}}
      {...overrides}
    />
    </MemoryRouter>,
  );
}

test("no outages renders nothing at all, not an empty container", () => {
  const html = renderToStaticMarkup(
    <OutageExcusePanel
      outages={[]}
      excludedBranches={new Set()}
      onToggleBranch={() => {}}
      onExcuse={() => {}}
    />,
  );
  assert.equal(html, "");
});

test("the panel header states branches, people and that nobody is judged", () => {
  const html = render();
  assert.match(html, /2 branches had no device data/);
  assert.match(html, /3 people/);
  assert.match(html, /nobody is being judged here/);
});

test("the action counts flags, not just people", () => {
  assert.match(render(), /Excuse 3 people · 3 flags/);
});

test("excluding a branch drops its people and flags from the action", () => {
  const html = render({ excludedBranches: new Set(["BRANCH_NO_DEVICE_DATA:DIS Iconic"]) });
  assert.match(html, /Excuse 1 person · 1 flag/);
});

test("an in-flight write disables the action and says so", () => {
  // The only double-submit guard on the largest write on the page. Without this
  // test, deleting `|| props.submitting` leaves all other tests green while a
  // hurried double-click fires two writes over thousands of flags.
  const html = render({ submitting: true });
  assert.match(html, /Excusing…/);
  // `disabled=""`, NOT a bare /disabled/. Button's class list always contains
  // the literal "disabled:pointer-events-none disabled:opacity-50", so
  // /<button[^>]+disabled/ matches the CLASS whether or not the attribute is
  // there — a re-review mutation-tested this exact regex and found the suite
  // stayed green with `|| props.submitting` deleted.
  assert.match(html, /<button[^>]*\sdisabled=""[^>]*>[^<]*Excusing…/);
  // Negative control: the same button, not submitting, must NOT be disabled.
  assert.doesNotMatch(render(), /<button[^>]*\sdisabled=""[^>]*>[^<]*Excuse /);
});

test("excluding every branch disables the action rather than offering zero", () => {
  const html = render({
    excludedBranches: new Set([
      "BRANCH_NO_DEVICE_DATA:DIS Iconic",
      "BRANCH_NO_DEVICE_DATA:ISBB",
    ]),
  });
  // Anchored to the excuse button specifically: a bare /disabled/ match would
  // pass if the disclosure were disabled and the write button left live.
  assert.match(html, /Select a branch to excuse/);
  assert.match(html, /<button[^>]*\sdisabled=""[^>]*>[^<]*Select a branch to excuse/);
});

test("a decided flag is not counted in the action", () => {
  const html = render({
    outages: [group("DIS Iconic", [member("DI-1", [flag("a"), flag("done", "matched")])])],
  });
  assert.match(html, /Excuse 1 person · 1 flag/);
});

test("the panel is a popover body, not a band — no frame of its own", () => {
  // It used to be a bordered amber <section> sitting above the queue at all
  // times. Inside a popover that frame would be a second border around a
  // surface that already has one.
  const html = render();
  assert.doesNotMatch(html, /<section/);
  assert.doesNotMatch(html, /rounded-md border border-amber/);
  // …and the work still survives the move.
  assert.match(html, /type="checkbox"|role="checkbox"/, "per-branch selection");
  assert.match(html, /href="\/hr-attendance"/, "the Device health link");
});

test("each branch row names its branch, its days and its size", () => {
  const html = render({
    outages: [
      group("DIS Iconic", [member("DI-1", [flag("a")])], ["2026-08-03", "2026-08-04"]),
    ],
  });
  assert.match(html, /DIS Iconic/);
  assert.match(html, /2 days with no sync row/);
  assert.match(html, /1 person · 1 flag/);
});

test("the panel states its own ceiling and links to device health", () => {
  const html = render();
  assert.ok(html.includes(OUTAGE_CEILING_NOTE));
  assert.match(html, /href="\/hr-attendance"/);
});

test("the panel never names a device serial", () => {
  assert.ok(!/serial/i.test(render()));
});

test("the branch list is bounded so it cannot outgrow the popover", () => {
  // Thirteen branches is today's real count. Without a cap the list would make
  // the popover taller than the viewport.
  const html = render();
  assert.match(html, /max-h-\[/);
  assert.match(html, /overflow-y-auto/);
});

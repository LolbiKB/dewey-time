import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DayCell } from "@/ui/DayTimeline";
import { DEFAULT_TIMELINE_INTL, type TimelineIntl } from "@/ui/timelineIntl";
import type { Day } from "@/types/calendar";

const DATE = new Date(2026, 7, 19);

/** 08:00–17:00 rostered, worked 08:07–17:06 with an hour of lunch out. */
function workedDay(): Day {
  return {
    date: "2026-08-19",
    shift: {
      shift_assigned: true,
      start_time: "08:00:00",
      end_time: "17:00:00",
      lunch_start: "12:00:00",
      lunch_end: "13:00:00",
    },
    first_in: "2026-08-19 08:07:00",
    last_out: "2026-08-19 17:06:00",
    checkins: [
      { time: "2026-08-19 08:07:00", log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 12:01:00", log_type: "OUT", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 13:02:00", log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 17:06:00", log_type: "OUT", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;
}

function render(props: Partial<Parameters<typeof DayCell>[0]> = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <DayCell
        date={DATE}
        outside={false}
        today={false}
        info={workedDay()}
        timelineStartMin={7 * 60}
        timelineEndMin={18 * 60}
        now={new Date(2026, 7, 19, 18, 0)}
        {...props}
      />
    </TooltipProvider>,
  );
}

test("without an inspector the day is not a button", () => {
  // The Mini App has no day sheet to open — it is HR's review surface and
  // carries flag evidence an employee must not see — so the cell was a
  // full-height <button> wired to an empty handler: a surface that presses and
  // does nothing.
  const html = render();
  assert.ok(!html.includes("<button"), "no button, and so no press affordance");
  assert.match(html, /<section/);
});

test("HR's week view keeps its button and its drill-in", () => {
  // The counterweight. This component is shared, and the Mini App's needs must
  // not quietly remove HR's way into the day sheet.
  const html = render({ onInspectDay: () => {} });
  assert.match(html, /<button/);
  assert.ok(!html.includes("<section"), "HR's cell is the button it always was");
});

test("the phone draws no lateness verdict", () => {
  // 08:07 against an 08:00 start is seven minutes late ONLY if grace is zero,
  // and the Mini App's payload deliberately carries no grace_minutes — so the
  // figure was computed against a threshold the engine never used and stamped
  // on the employee's own punch block.
  const withVerdict = render();
  assert.match(withVerdict, /\+7m|Late/, "HR still sees it by default");

  const phone = render({ showLateness: false });
  assert.ok(!/Late/.test(phone), "the word never reaches the phone");
  assert.ok(!/\+7m/.test(phone), "nor the figure");
});

test("a suppressed verdict does not take the punch times with it", () => {
  // The fix must remove the judgement, not the record.
  const phone = render({ showLateness: false });
  assert.match(phone, /8:07AM/);
  assert.match(phone, /5:06PM/);
});

test("the gap bands name themselves when asked, and are announced either way", () => {
  // Their meaning lived only in a hover tooltip, which a touch device cannot
  // open — so on the one device this app runs on, the lunch band was a grey
  // rectangle with no name.
  const unlabelled = render();
  assert.match(unlabelled, /sr-only/, "still announced to a screen reader");

  const labelled = render({ labelBands: true });
  assert.match(labelled, /Lunch/, "and visible on the canvas");
});

test("every word and number on the canvas comes from the injected intl", () => {
  // The real proof that nothing is hard-coded: swap the whole vocabulary and
  // check the English is gone rather than checking one translated string is
  // present.
  const shouted: TimelineIntl = {
    punch: () => "PUNCH",
    duration: () => "DURATION",
    hour: () => "HOUR",
    label: (key) => `LABEL:${key}`,
  };
  const html = render({ intl: shouted, labelBands: true });

  assert.match(html, /PUNCH/);
  assert.match(html, /DURATION/);
  assert.match(html, /LABEL:lunch/);
  // The English defaults must be absent, not merely outnumbered.
  assert.ok(!html.includes("Lunch"), "no English word survived the swap");
  assert.ok(!/\d+h \d+m/.test(html), "no English duration survived it either");
});

test("omitting the intl renders exactly what it rendered before", () => {
  // The default IS the previous behaviour, which is what keeps HR's week view
  // untouched by all of the above.
  assert.equal(render(), render({ intl: DEFAULT_TIMELINE_INTL }));
});

test("the accessible name can be replaced, and defaults to HR's", () => {
  assert.match(render(), /aria-label="Wednesday 19 August/);
  assert.match(
    render({ accessibleName: "ថ្ងៃពុធ ១៩ សីហា" }),
    /aria-label="ថ្ងៃពុធ ១៩ សីហា"/,
  );
});

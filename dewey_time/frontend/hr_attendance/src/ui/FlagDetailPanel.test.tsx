import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FlagDetailPanel } from "@/ui/FlagDetailPanel";
import type { Flag } from "@/types/calendar";

const FLAG: Flag = {
  name: "FLAG-0001",
  flag_code: "LATE_START",
  status: "OPEN",
  severity: "WARNING",
  day_closed: 1,
  is_provisional: false,
  evidence: {},
};

// /hr-flags is now where HR decides; Desk is a fallback record view, not the
// primary action. "Review in Desk" — a primary Button, the panel's only call to
// action — used to be what sent HR back to Desk out of habit. It must now read
// as a secondary link labelled "Open record".
test("FlagDetailPanel demotes the Desk link to a secondary 'Open record' action", () => {
  const html = renderToStaticMarkup(
    <FlagDetailPanel
      flag={FLAG}
      date="2026-08-04"
      employeeLabel="Jane Doe"
      employeeId="EMP-0001"
    />
  );
  assert.doesNotMatch(html, /Review in Desk/, "old primary-button label should be gone");
  assert.match(html, /Open record/, "expected the new secondary label");

  const linkStart = html.indexOf("Open record");
  const tagStart = html.lastIndexOf("<a", linkStart);
  const tagEnd = html.indexOf(">", tagStart);
  const anchorHtml = html.slice(tagStart, tagEnd);
  // dewey-ui's Button stamps data-variant on the rendered element even when
  // `asChild` hands it off to a plain <a> (dewey-ui button.tsx:62-67) — "link" is
  // its lowest-emphasis style; "default" (the prior implicit value) is the
  // filled, primary one.
  assert.match(
    anchorHtml,
    /data-variant="link"/,
    "expected the low-emphasis link variant, not a primary button"
  );
});

test("showDeskReview=false still hides the record link entirely (prop contract preserved)", () => {
  const html = renderToStaticMarkup(
    <FlagDetailPanel
      flag={FLAG}
      date="2026-08-04"
      employeeLabel="Jane Doe"
      employeeId="EMP-0001"
      showDeskReview={false}
    />
  );
  assert.doesNotMatch(html, /Open record/);
  assert.doesNotMatch(html, /Review in Desk/);
});

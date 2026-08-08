import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AvatarLoadingRing, EmployeeAvatar } from "@/ui/EmployeeAvatar";
import type { CalendarEmployee } from "@/types/calendar";

function employee(overrides: Partial<CalendarEmployee> = {}): CalendarEmployee {
  return { id: "EMP-1", label: "EMP-1 · Sokheng Hon", employee_name: "Sokheng Hon", ...overrides };
}

/** The circle's own classes carry `bg-muted` too, so assert on the tag itself. */
function imgTag(html: string): string {
  return html.match(/<img[^>]*>/)?.[0] ?? "";
}

test("an employee with no photo renders initials, not a broken image", () => {
  const html = renderToStaticMarkup(<EmployeeAvatar employee={employee()} className="size-10" />);
  assert.match(html, />SH</);
  assert.equal(html.includes("<img"), false);
});

test("the initials are in the DOM while the photo is still loading", () => {
  // The property that stops the half-drawn paint: they are present BEFORE any
  // load event, not merely when `image` is absent.
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.match(html, />SH</);
  assert.match(html, /<img/);
});

test("the photo starts transparent and fades in", () => {
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.match(html, /opacity-0/);
  assert.match(html, /transition-opacity/);
});

test("reduced motion gets the photo whole rather than not at all", () => {
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.match(html, /motion-reduce:transition-none/);
});

test("the photo is non-urgent — decode never blocks paint, and forty rows do not all fetch", () => {
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.match(html, /decoding="async"/);
  assert.match(html, /loading="lazy"/);
});

test("no ring on first paint, even with a photo pending", () => {
  // The anti-flicker property, at the render layer: the delay has not elapsed.
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.equal(html.includes('role="status"'), false);
});

test("each photo starts from scratch — the pending state is derived from the current src", () => {
  // A list row is reused for a different employee as the queue refetches, and a
  // stale "loaded" would show the previous person's photo under the new person's
  // initials. What static markup can prove is the mount-time half: whichever src
  // is passed is the one rendered, and it renders pending (transparent, unringed)
  // rather than assumed-loaded. The runtime half — re-running that derivation when
  // `src` changes on an already-mounted avatar — is carried by the `image`-keyed
  // effect, which `renderToStaticMarkup` never runs and no test here exercises.
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ id: "EMP-2", image: "/files/dara.jpg" })} className="size-10" />,
  );
  assert.match(html, /src="\/files\/dara\.jpg"/);
  assert.doesNotMatch(html, /sokheng/);
  assert.match(html, /opacity-0/);
  assert.equal(html.includes('role="status"'), false);
});

test("a photo with transparency does not leave the initials showing through it", () => {
  // `object-cover` promises the photo covers the box geometrically, not that it is
  // opaque. A PNG with an alpha channel would show the layer underneath forever —
  // the one state where layering would be worse than the `or` it replaced.
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.png" })} className="size-10" />,
  );
  assert.match(imgTag(html), /bg-muted/);
});

test("the initials are decoration — the name is already in the row", () => {
  // Every caller renders the employee's name as adjacent text, and one of them
  // (EmployeePicker's trigger) is a combobox whose accessible name is computed
  // from its contents — unhidden initials would prepend "SH" to it.
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.match(html, /<span[^>]*aria-hidden="true"[^>]*>SH</);
});

test("the ring carries Spinner's accessibility contract even though it cannot take its shape", () => {
  const html = renderToStaticMarkup(<AvatarLoadingRing />);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Loading"/);
});

test("the ring spins, and stops rather than vanishing under reduced motion", () => {
  const html = renderToStaticMarkup(<AvatarLoadingRing />);
  assert.match(html, /animate-spin/);
  assert.match(html, /motion-reduce:animate-none/);
  // Stopped, and dimmed rather than gone: a still ring at full strength would read
  // as a decorative border instead of "still arriving".
  assert.match(html, /motion-reduce:text-muted-foreground\/60/);
});

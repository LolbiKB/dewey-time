import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EmployeeIdentity } from "@/ui/EmployeeIdentity";

const BASE = { englishName: "Sophea Chan", employeeId: "EMP-0088", khmerName: "ចាន់ សុភា" };

/**
 * The class attribute of every span `text` sits inside: outermost first, the
 * element holding the text itself last.
 *
 * Asserting a class against the whole document passes when the class landed on
 * the WRONG element, which is the bug worth catching, so everything below that
 * cares about which element carries a class goes through here.
 */
function enclosingClasses(html: string, text: string): string[] {
  const at = html.indexOf(text);
  assert.ok(at >= 0, `"${text}" is in the markup`);

  const open: string[] = [];
  for (const tag of html.slice(0, at).matchAll(/<span([^>]*)>|<\/span>/g)) {
    const attrs: string | undefined = tag[1];
    if (attrs === undefined) open.pop();
    else open.push(/class="([^"]*)"/.exec(attrs)?.[1] ?? "");
  }
  return open;
}

/** The classes on the element `text` sits directly inside. */
function classesOn(html: string, text: string): string[] {
  const own = enclosingClasses(html, text).at(-1);
  assert.ok(own !== undefined, `"${text}" sits inside a span`);
  return own.split(" ").filter(Boolean);
}

/** Every class on `text`'s own element and on each element it sits inside. */
function classesAround(html: string, text: string): string[] {
  return enclosingClasses(html, text)
    .flatMap((attr) => attr.split(" "))
    .filter(Boolean);
}

/** Would this class render text below the 14px line one is measured at? */
function shrinksBelow14px(cls: string): boolean {
  if (cls === "text-xs") return true; // 12px
  const arbitrary = /^text-\[(\d+)px\]$/.exec(cls);
  return arbitrary !== null && Number(arbitrary[1]) < 14;
}

test("line one is the English name then the Khmer name, in that order", () => {
  // The order is the whole contract. A component that renders both but puts
  // the Khmer first is a different design and would pass any "contains" check.
  const html = renderToStaticMarkup(<EmployeeIdentity {...BASE} />);
  assert.ok(html.indexOf("Sophea Chan") < html.indexOf("ចាន់ សុភា"), "English leads");
  assert.ok(html.indexOf("ចាន់ សុភា") < html.indexOf("EMP-0088"), "ID is on line two");
});

test("the Khmer name is present in the markup even where it will be hidden", () => {
  // It is dropped by a container query, not by React. The element must exist so
  // the query has something to hide -- and so a wide surface shows it without a
  // second render path.
  assert.match(renderToStaticMarkup(<EmployeeIdentity {...BASE} />), /ចាន់ សុភា/);
});

test("no Khmer name renders no separator", () => {
  // A bare middot with nothing after it reads as a rendering fault.
  const html = renderToStaticMarkup(<EmployeeIdentity {...BASE} khmerName={null} />);
  assert.doesNotMatch(html, /·/, "no separator without a second name");
  assert.match(html, /Sophea Chan/);
  assert.match(html, /EMP-0088/);
});

test("the Khmer name never carries a smaller font size than the English name", () => {
  // Measured: at 11px the subscript consonants in ណ្ណ compress into each other
  // and at 10px they are illegible. Khmer wants to be equal to or larger than
  // Latin at the same nominal size, never smaller. This is the assertion that
  // stops a future "just shrink it to fit", so it reads the Khmer element's own
  // classes AND its ancestors' -- a size set anywhere up that chain shrinks it.
  const html = renderToStaticMarkup(<EmployeeIdentity {...BASE} />);
  const around = classesAround(html, "ចាន់ សុភា");

  assert.ok(around.includes("text-sm"), `line one is not 14px: ${around.join(" ")}`);
  for (const cls of around) {
    assert.ok(!shrinksBelow14px(cls), `${cls} shrinks the Khmer name below 14px`);
  }
});

test("tail facts render in the order the caller gave them", () => {
  // The caller's order is load-bearing: the Weekly Schedule wizard puts
  // employment type first because isWeeklyScheduleEligible gates on it, and a
  // component that re-sorted would eventually drop the one fact that matters.
  const html = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} tail={[{ label: "Full-time" }, { label: "Retail" }]} />,
  );
  assert.ok(html.indexOf("Full-time") < html.indexOf("Retail"));
});

test("a warning-toned fact is visually distinct, not just differently worded", () => {
  // On the fact's OWN span: a tone class anywhere in the document would satisfy
  // a whole-markup match while colouring some other element entirely.
  const html = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} tail={[{ label: "No employment type", tone: "warning" }]} />,
  );
  const own = classesOn(html, "No employment type");
  assert.ok(
    own.some((cls) => cls === "text-brand-accent" || cls.startsWith("text-amber-")),
    `the warning fact carries no tone of its own: ${own.join(" ")}`,
  );
});

test("the avatar slot renders whatever the caller passed, outside the query container", () => {
  // Outside, because the avatar's footprint differs by surface (36+10 register,
  // 32+8 picker row, 40+12 trigger) and one threshold measured across the whole
  // box would mean three different text budgets.
  const html = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} avatar={<i data-slot="test-avatar" />} />,
  );
  const avatarAt = html.indexOf("test-avatar");
  const containerAt = html.indexOf("@container");
  assert.ok(avatarAt >= 0, "the slot renders");
  assert.ok(avatarAt < containerAt, "the avatar precedes the query container");
});

test("no avatar prop renders no avatar box", () => {
  assert.doesNotMatch(renderToStaticMarkup(<EmployeeIdentity {...BASE} />), /test-avatar/);
});

test("the container query is on the text stack and carries the agreed thresholds", () => {
  // A class-string assertion cannot prove geometry -- e2e does that -- but it
  // can prove the thresholds did not drift from the spec by an edit nobody
  // measured. 200 for the Khmer name, 120/170/230 for the caller's facts.
  const html = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} tail={[{ label: "a" }, { label: "b" }, { label: "c" }]} />,
  );
  assert.match(html, /@container/);
  assert.match(html, /@min-\[200px\]:/);
  assert.match(html, /@min-\[120px\]:/);
  assert.match(html, /@min-\[170px\]:/);
  assert.match(html, /@min-\[230px\]:/);
});

test("a fourth fact shares the third's threshold rather than dropping off the ladder", () => {
  // By 230px the surface is wide enough that one more short fact is not what
  // breaks it. A fourth with no variant at all would be permanently hidden --
  // `hidden` with nothing to turn it back on -- which is the failure this pins.
  const html = renderToStaticMarkup(
    <EmployeeIdentity
      {...BASE}
      tail={[
        { label: "First" },
        { label: "Second" },
        { label: "Third" },
        { label: "Fourth" },
      ]}
    />,
  );
  const fourth = classesOn(html, "Fourth");
  assert.ok(
    fourth.includes("@min-[230px]:inline"),
    `a fourth fact is never revealed: ${fourth.join(" ")}`,
  );
});

test("nameSlot stamps line one, and omitting it leaves the name span unhooked", () => {
  // The register's e2e finds the Employee cell by data-slot="employee-name", so
  // that hook has to survive the move into this component. It is opt-in: a
  // surface that did not ask for a hook must not silently acquire one.
  const stamped = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} nameSlot="employee-name" />,
  );
  assert.match(stamped, /<span[^>]*data-slot="employee-name"[^>]*>Sophea Chan/);

  assert.doesNotMatch(renderToStaticMarkup(<EmployeeIdentity {...BASE} />), /data-slot/);
});

test("the separators are decoration, not content a screen reader reads out", () => {
  // Seven surfaces draw this row; an unhidden middot is "middle dot" announced
  // between every field, on every one of them.
  const html = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} tail={[{ label: "Full-time" }]} />,
  );
  assert.equal((html.match(/·/g) ?? []).length, 2, "one separator per joined field");
  assert.equal(
    (html.match(/<span aria-hidden="true"[^>]*>·<\/span>/g) ?? []).length,
    2,
    "every separator is hidden from assistive tech",
  );
});

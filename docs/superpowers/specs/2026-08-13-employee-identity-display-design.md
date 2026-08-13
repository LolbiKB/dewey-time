# Employee Identity Display — Design

**Date:** 2026-08-13
**Status:** design agreed, pending spec review

## Goal

One shared component renders an employee's identity everywhere `dewey_time` shows a person, and
it displays the Khmer name ERPNext already holds whenever the space it is given can fit it whole.

## Why now

Two problems, one cause.

**The Khmer name is invisible.** Prod's Employee doctype carries `custom_khmer_first_name` and
`custom_khmer_last_name` — Data fields, both `in_global_search`, positioned in the form between
`last_name` and `employee_name`, i.e. inside the identity block rather than off in a tab. Most of
the roster has both filled; a handful have neither. Nothing in `dewey_time` reads them.

**Seven surfaces already disagree about how to draw a person.** They were written independently
and have drifted:

| Surface | Today | Name form |
|---|---|---|
| `EmployeePicker` trigger | avatar 40 · name / *title · dept · employment type* | middle name stripped |
| `EmployeePicker` list row | avatar 32 · name / *id · title · dept* · Clock badge | stripped |
| `ScheduleEmployeePicker` | avatar · name / *employment type* | stripped |
| Coverage register, Employee column | avatar 36 · name / *id* | full |
| Flag queue list | avatar · name | full |
| Flag decision panel | name, bold, no avatar | full |
| Schedule import preview | `employee_name ?? id_card` | full |

`stripMiddleName` in the pickers and the raw name in the tables means the same person already reads
two ways depending on where you are standing. Adding a Khmer name to seven independently-written
call sites is how that becomes seven different answers to "what happens when it is missing".

## Measurements this design rests on

All taken in Chromium against the running app, with Kantumruy Pro's Khmer subset explicitly loaded.
The app renders no Khmer today, so any metric taken without forcing the font is a fallback font's —
two earlier passes were discarded for exactly that, and for measuring a shrink-to-fit box with a
`width:100%` probe.

**Text budget** — the width left for text after the avatar, gap and cell padding:

| Context | @1280 | @375 |
|---|---|---|
| Picker trigger | 361px | 184px |
| Picker popover row | 345px | 168px |
| Register Employee column | 139px | 90px |
| Flag queue row | not measured — the queue is empty under the test fixtures | |

**Name widths at 14px semibold:**

| | Latin | Khmer | `Latin · Khmer` one line |
|---|---|---|---|
| Sovannary Heng · ហេង សុវណ្ណារី | 110 | 75 | **194** |
| Chantrea Nhem · ញ៉ែម ចន្ទ្រា | 104 | 57 | 170 |
| Sophea Chan · ចាន់ សុភា | 89 | 53 | 151 |
| Dara Sok · សុខ ដារា | 61 | 48 | 119 |

**Register columns @1280:** Employee 209, Branch 127, Dept 125, Status 101, Schedule 123,
Hrs/wk 126, Biometric 236, Action 167. Table 1214px in a 1214px scroller — it exactly fills, so
widening any column either steals from another or introduces horizontal scroll. At 375 the table is
929px in a 333px scroller: it already scrolls 596px.

**Three findings that changed the design:**

1. **Khmer at 14px does not grow the row.** Measured 52px before and after promoting it to line one
   at full size. Its stacked marks fit inside the same line box as 14px Latin. This was the main
   objection to giving it equal weight and it did not survive measurement.
2. **Khmer runs about a third narrower than the equivalent Latin name** (48–75px against 61–110px).
3. **The register already truncates Latin names on a phone** — "Sovannary Heng" needs 110px against
   a 90px budget. True today, before any of this.

## The rule

**Line one — the English name, then `·` and the Khmer name when the box can fit both whole.**

**Line two — the employee ID, then the caller's declared facts in the caller's order, as many as fit.**

Never a third line. The order never changes with width. The only thing space decides is how far down
each line it gets.

### Priority

```
English name  →  Employee ID  →  Khmer name  →  caller's facts
```

Fill from the left, drop from the right. The English name and the ID are never dropped; everything
after them is conditional on room.

### Why the Khmer name is dropped rather than shrunk or truncated

Shrinking was measured and cannot work. At the register's 139px the English name alone consumes
110px, leaving 20px — the Khmer would have to render at **3px** for the longest name and 10px for a
mid-length one. A rendered ramp at 15/14/13/12/11/10px shows the subscript consonants in ណ្ណ and
ន្ទ្រ compressing into each other by 11px and illegible at 10px. Khmer wants to be equal to or
slightly larger than Latin at the same nominal size, not smaller.

Truncating was rejected for a different reason: Khmer has no inter-word spaces, so an ellipsis lands
mid-cluster. Observed: `ហេង សុវណ្ណារី` cut to `ហេង សុវ`, which reads as a rendering fault rather
than a deliberate omission.

So when there is not room for both names, the Khmer is **not rendered at all**. Because a container
query hides the element rather than `text-overflow` cutting a string, no ellipsis ever appears.

### Ownership

**Identity belongs to the component.** English name, employee ID, Khmer name — same three, same
order, every surface. No call site can reorder them or forget the Khmer name.

**The tail belongs to the caller.** Each surface passes an ordered list of the facts that matter for
what it is asking:

| Surface | Tail |
|---|---|
| Coverage register | *(none — Branch, Dept and Status are its own columns)* |
| `EmployeePicker` | department, title |
| `ScheduleEmployeePicker` | **employment type first**, then department |
| Flag decision panel | department, title |

`ScheduleEmployeePicker` is why the tail cannot be one global list: `isWeeklyScheduleEligible` gates
the Weekly Schedule wizard on employment type, so that fact tells the reader whether the person can
be picked at all. Under a fixed global priority it would eventually be the thing that fell off.

## Architecture

### `EmployeeIdentity` — the component

New file: `src/ui/EmployeeIdentity.tsx`. Presentational, no data fetching, no hooks, so it renders
under `renderToStaticMarkup` in the existing suite — the same constraint `AlertDot`, `FacetOptions`
and `RegisterFilterBar` are built to.

```
EmployeeIdentityProps = {
  englishName: string
  employeeId: string
  khmerName: string | null     // composed, never the two raw fields
  avatar?: { image: string | null; size: 32 | 36 | 40 } | "none"
  tail?: TailFact[]            // ordered; caller's choice
}
TailFact = { label: string; tone?: "normal" | "warning" }
```

The caller passes a composed `khmerName`, not the two fields, so the composition rule lives in one
tested function rather than at every call site.

**The avatar is a per-surface prop and never space-driven.** A surface decides once whether it shows
one; the ladder never takes it away. This was tested against the alternative and rejected: because
the avatar plus gap is 46px, dropping it in the 200–245px band is exactly what would buy the Khmer
name there — but the avatar then disappears as the box narrows and *reappears* as it narrows further,
which reads as a rendering fault. A surface deciding once is legible; a decoration that comes and
goes as you resize is not. The register keeps its avatar and therefore does not show a Khmer name;
that is the accepted trade, not an oversight.

### `khmerName()` — the pure composition rule

Added to `src/lib/employeeCard.ts`, beside the existing name helpers.

```
khmerName(last: string | null, first: string | null): string | null
```

- Both present → `"${last} ${first}"` — family name first, matching the convention the vendored
  ADMS reference frontend already uses (`user-combobox.tsx`).
- One present → that one. A partial name is still a name; absence of one field is not absence of
  the person's Khmer name.
- Neither, or whitespace only → `null`.

### Adaptation: container queries, not media queries

`container-type: inline-size` on the component's own box, with Tailwind v4's `@container`.

This is not a stylistic preference. The register's Employee cell is **139px at a 1280 viewport and
90px at 375**, while a picker row at that same 375 viewport is **168px**. A viewport breakpoint
cannot tell those apart. Tailwind is 4.3.0 (container queries built in, no plugin) and dewey-ui
already ships one (`@container/field-group`), so the pattern is precedented in the design system.

**The container goes on the text stack, not on the component root.** The avatar sits outside it, as a
sibling:

```
<div class="flex items-center gap-…">      ← avatar + stack, NOT the container
  <EmployeeAvatar …/>                      ← outside the query
  <div class="@container flex-1 min-w-0">  ← container-type: inline-size
    line one
    line two
  </div>
</div>
```

Two reasons. The avatar's footprint differs by surface — 36px + 10px gap in the register, 32 + 8 in a
picker row, 40 + 12 in the trigger — so one threshold measured on the whole box would mean three
different text budgets. And measuring the stack means every threshold below is stated in the same
units as the name widths they were derived from.

Verified in Chromium rather than assumed: `container-type: inline-size` on a `flex-1 min-w-0` item
reports the width flex assigned it, not its content width. Probed at six row widths — a 385px row
gives a 329px stack and fires a `min-width: 200px` query; a 246px row gives 190px and does not.

### Thresholds

Set from the measured worst case, not the typical one. **All widths are the text stack's**, per the
container placement above — not the component box, and not the table cell.

| Threshold | Turns on | Worst case needs |
|---|---|---|
| `≥ 200px` | Khmer name on line one | 194px |
| `≥ 120px` | first caller fact on line two | 110px |
| `≥ 170px` | second caller fact | 158px |
| `≥ 230px` | third caller fact | 206px |

For anyone reading a rendered box rather than the stack, the avatar and gap to add back:

| Surface | Avatar + gap | Stack @1280 | Box @1280 | Stack @375 | Box @375 |
|---|---|---|---|---|---|
| Picker trigger | 40 + 12 = 52 | 361 | 413 | 184 | 236 |
| Picker popover row | 32 + 8 = 40 | 345 | 385 | 168 | 208 |
| Register Employee cell | 36 + 10 = 46 | 139 | 185 | 90 | 136 |

Where each context lands:

| Context | Budget | Line one | Line two |
|---|---|---|---|
| Picker trigger @1280 | 361 | English · Khmer | ID · fact · fact · fact |
| Picker popover row @1280 | 345 | English · Khmer | ID · fact · fact · fact |
| Flag decision panel | wide | English · Khmer | ID · fact · fact |
| Picker trigger @375 | 184 | English | ID · fact · fact |
| Picker popover row @375 | 168 | English | ID · fact |
| Register @1280 | 139 | English | ID |
| Register @375 | 90 | English | ID |

The register shows only the ID at 139px even though the width would admit a caller fact, because the
register declares an empty tail — Branch, Dept and Status are its own columns. A threshold decides
the *most* that fits; the caller decides what is offered.

**Consequence, stated plainly:** under these thresholds the Khmer name appears on desktop pickers and
the decision panel, and nowhere else. The register never shows it, at any viewport, and neither does
a phone-sized picker. That follows directly from the rule — where the space only fits the English
name, the Khmer is not shown — but it is the design's biggest single trade and it should be reviewed
as such. See Open Questions.

### Backstop

`text-overflow: ellipsis` stays on both lines for a name longer than anything measured. Because the
Khmer name is last on line one, the ellipsis eats it first and the English name stays whole — the
failure order matches the priority chain without any extra rule.

## Backend

### Install the custom fields

`custom_khmer_first_name` and `custom_khmer_last_name` were added through the Frappe UI, so they
exist on prod and on **no freshly created site**. CI builds its site with `bench new-site` and the
sandbox harness installs the app from scratch; neither has the column. A query selecting them
unconditionally passes locally against a prod restore and fails in CI.

Add both to `CUSTOM_FIELDS` in `dewey_time/setup/custom_fields.py`, under an `"Employee"` key, so
the app owns the schema it reads. `create_custom_fields` is idempotent, so this is a no-op on prod.

### Select them

`hr_calendar.py:345` currently selects `["name", "employee_name", "designation", "department",
"company", "image", "branch"]`. Add both Khmer fields, and map them into the output dict — the
mapping is the step that matters. A field selected and then dropped by an explicit output dict is a
production no-op that yields `None` forever; that exact defect shipped in this file for `branch` and
was caught in review.

The same addition is needed wherever an employee list reaches the frontend: the coverage feed, the
enrollment feed, and the flag queue.

### Close the anonymiser gap

`_scrub_specs()` in `dewey_time/utils/anonymize.py` scrubs Employee's `employee_name`, `first_name`,
`last_name`, both emails, cell number, bank account, passport and DOB. It does **not** scrub either
Khmer field. The sandbox engine's baseline scrub covers no Employee fields at all — only User,
Contact, Communication, Email Queue, Address and the logs — so nothing else catches them.

Every `seed --prod` restore has therefore been carrying real Khmer names into the sandbox in the
clear. Add both to the Employee spec, scrubbed the same way `first_name` is. `custom_telegram_chat_id`
is unscrubbed for the same reason and should go in the same change.

### Search

Both fields are `in_global_search` in ERPNext, so HR already expects to find people by them. Neither
`employeeSearchHaystack` nor `filterRegisterRows` includes them today. Add the composed Khmer name to
both.

Khmer has no inter-word spaces, so substring matching behaves differently from Latin — a query of
`សុភា` must match `ចាន់ សុភា` even though there is no token boundary the Latin path would recognise.
`employeeCommandFilter` splits the *query* on whitespace and requires each token to appear in the
haystack, which is correct for Khmer as written, but it needs a test that would fail if someone
"optimised" it into a word-boundary match.

## Testing

The existing suite has no jsdom and no React Testing Library. `renderToStaticMarkup` for components,
`node:test` for pure functions, Playwright for anything geometric.

**Pure (`src/lib/employeeCard.test.ts`):** `khmerName` — both fields, last only, first only, neither,
whitespace-only, and family-name-first ordering.

**Component (`src/ui/employeeIdentity.test.tsx`):** the rendered markup for each data case — both
names, no Khmer, one Khmer field, and each tail configuration. Line order and the `·` separator.

**Geometric (`e2e/`), because no unit test can see any of it:**

- At each measured budget, assert which parts are present. A container query that never matches, or
  one whose threshold drifted, is invisible to `renderToStaticMarkup`.
- Assert **nothing is clipped** at every threshold boundary — `scrollWidth <= clientWidth` on both
  lines — using the worst-case name. This is the assertion that would have caught the 3px-Khmer and
  the mid-cluster ellipsis.
- Assert the row height does not change when a Khmer name is present, at a fixed width.
- Assert the Khmer subset font actually loaded before measuring. Two measurement passes during design
  were wrong because it had not; a test that measures a fallback font is a test that cannot fail
  correctly.
- Search: typing Khmer narrows the picker and the register.

The e2e fixtures need Khmer names added, including a no-Khmer employee and a one-field-only employee.
The flag queue fixtures need at least one flag so its row can be measured at all.

## Migration

`stripMiddleName` goes. All seven surfaces show `employee_name` as ERPNext records it, with
truncation doing any shortening — a silently-shortened name and a visibly-truncated one are different
claims, and only one of them admits something was left out. The function and its tests are deleted,
not left orphaned.

The three pickers' hand-built subtitle strings are replaced by `tail` declarations. Any difference
that remains between surfaces is one a surface declared, rather than one it drifted into.

## Open questions

1. **Latin name order.** Unknown whether `first_name`/`last_name` are entered family-first, so
   whether `employee_name` already reads "Chan Sophea" and matches the Khmer order. No layout
   consequence either way — the two names are separated by `·` and each is rendered whole — but if
   they disagree the pairing will read oddly to a Khmer speaker. Worth checking against prod before
   implementation; does not block it.

2. **Whether the register should get the Khmer name.** Under the agreed thresholds it does not, at
   any viewport, and the two cheapest ways to change that have both been considered and declined.
   Dropping the register's avatar would buy 46px, taking its stack to 185px — enough for three of the
   four measured names but 9px short of the longest — and was declined with the avatar decision above.
   Widening the Employee column by ~60px would work, but it has to come out of Biometric (236px) or
   Action (167px), or add horizontal scroll at 1280 where the table currently fills its scroller
   exactly. That remains available as a later, separate change: it alters the register's column
   layout, which is a different decision from how one person is drawn.

3. **Fixed thresholds versus per-row measurement.** A fixed 200px threshold denies the Khmer name to
   short names that would have fitted at 168px (`Sophea Chan · ចាន់ សុភា` needs 151px). Exact
   behaviour needs JS measurement per row — feasible, since the register paginates to 50 rows, but
   materially more complex than a CSS rule. The fixed threshold is the recommendation; this records
   what it costs.

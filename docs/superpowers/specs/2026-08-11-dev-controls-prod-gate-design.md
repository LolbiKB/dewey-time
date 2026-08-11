# Dev controls leave the production bundle

**Punch list:** T1-5 · **Found:** 2026-07-03 (Task 12 permissions audit)

## The defect

Four controls labelled "(dev)" render in the production HR UI:

| Control | Component | Mounted at |
|---|---|---|
| "Clear schedule (dev)" | `ClearEmployeeScheduleDialog` | `WeeklySchedulePage` |
| "Clear all (dev)" | `ClearAllSchedulesDialog` | `WeeklySchedulePage` |
| "Wipe patterns (dev)" | `ClearSitePatternsDialog` | `WeeklySchedulePage` |
| "Run flag engine (dev)" | `RunEngineDialog` | `AttendanceToolbar` |

The punch list names the first three and places them at
`WeeklySchedulePage.tsx:351–375`. They have since been extracted into their own
dialog components, each owning its trigger. `RunEngineDialog` is not in the
original entry and is added here: it is labelled "(dev)", it deletes and
re-inserts flags, and it sits in the same HR UI. Hiding three of four dev
controls would be an arbitrary line.

### What it is, precisely

**Not** "any HR user can wipe production." The backend is genuinely gated: every
destructive path requires System Manager via
`dev_tools._require_system_manager_for_clear()`, and each dialog also demands a
typed-name confirmation.

The controls are also **already role-gated in the SPA**, contrary to how the
entry reads — `WeeklySchedulePage` redirects non-HR-staff away entirely
(`:292`), and `RunEngineDialog` is wrapped in `hrStaff`
(`AttendanceToolbar.tsx:138`). The SPA learns this from `hr_staff` on the
calendar session payload (`useCalendarSession.ts:24`).

So the real defect is narrower and more precise than "ungated": **the gate is
set to the wrong role.** `hr_staff` means `System Manager | HR User |
HR Manager` (`hr_calendar.HR_STAFF_ROLES`), while executing any of these
requires System Manager alone. An HR User is shown three buttons that wipe
schedule data and cannot use any of them — they get a permission error after
typing a confirmation. That is a UX and defence-in-depth problem, not a
privilege escalation.

## Approach

Gate all four on the build, not the role: they do not render in a production
bundle at all.

**Why not fix the role instead** — matching the gate to `System Manager` would
need a new capability signal, since `hr_staff` is the only role fact the SPA
has and it is the wrong one. That is more code, and it preserves a button on a
production HR system whose job is to delete every employee's schedule data.
Build-gating removes the question. A genuine administrative need still has
Desk and `bench execute`, which is where an operation of that size belongs.

This also makes the wrong-role observation moot rather than fixed: with the
controls absent from production, `HR User` versus `System Manager` no longer
matters for them.

## The gate

One shared constant, `src/lib/devBuild.ts`:

```ts
export const IS_DEV_BUILD = Boolean(import.meta.env?.DEV);
```

**The `?.` is load-bearing.** `import.meta.env` is a Vite construct and does not
exist under `tsx --test`, the web test runner — verified: both
`import.meta.env` and `import.meta.env?.DEV` evaluate to `undefined` there.
Written as `import.meta.env.DEV`, every test that imports a gated dialog dies
on `TypeError: Cannot read properties of undefined`.

With the optional chain it reads falsy under test, so **the test environment
behaves exactly like a production build** — which is what makes the render
tests below possible without any mocking.

A single constant means this subtlety is reasoned about once rather than
rediscovered at four call sites.

## Where the guard goes

Inside each of the four components, as an early `return null` before any hooks.
`IS_DEV_BUILD` is constant for the life of the process, so hook order never
varies between renders of the same mount and the rules of hooks are satisfied.

**Inside the component, not at the mount site.** These four already live at two
different mount points, and they have moved once already — the punch list cites
line numbers in a file where they no longer are. A component that refuses to
render itself cannot be un-gated by someone adding a fifth mount. It is also
enforceable: a source-text test can assert "this module contains the guard",
where asserting "every JSX mount is wrapped" would require parsing.

**Limitation, stated rather than glossed:** this stops them *rendering*, not
*shipping*. The modules are still statically imported by their parents, so the
code stays in the bundle. Removing it would require lazy imports at each mount;
for four small dialogs that is complexity without a matching benefit, and the
goal is that they are absent from the HR UI, not that the bundle shrinks.

## Verification

The trap: "assert the button is absent" passes just as well when the render
harness is silently broken. Absence is only evidence next to a working control.

- **A render test per dialog** — the trigger label does not appear in
  `renderToStaticMarkup` output. Follows the existing pattern in
  `src/ui/DayChips.test.tsx`.
- **A control in the same file** — `SpreadsheetImportTrigger`, which is a real
  HR feature and not gated, *does* render. This is what makes the four absence
  assertions meaningful.
- **A source-text test** — all four modules import `IS_DEV_BUILD` and return
  early, in the idiom of the existing `src/ui/dialogMigration.test.tsx`.
- **A unit test on the constant** — falsy when `import.meta.env` is undefined,
  which is the state under the runner.

**What is not covered, deliberately:** the `IS_DEV_BUILD === true` branch.
Nothing can set the Vite env under `tsx`, so no test here can prove the buttons
*do* appear in a dev build. That path is covered by developers seeing them on
the dev server. Claiming otherwise would be the kind of green-that-proves-
nothing this repo has been burned by twice.

## Scope

**In:** the four controls, the shared constant, the four tests, and the
punch-list closure.

**Out:** backend gating (already correct — `_require_system_manager_for_clear`
stays exactly as it is, and remains the actual security boundary); removing the
dialog code from the bundle; and adding a System Manager capability signal to
the SPA, which this change makes unnecessary.

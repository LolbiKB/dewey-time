# HR SPA → ADMS parity

**Date:** 2026-07-28
**Status:** Approved (design)

## Problem

The two frontends in this repo — `frontend/hr_attendance` and `frontend/adms` —
share `@lolbikb/dewey-ui` and are maintained by one person, but diverge in
everything above the primitives:

| | ADMS | HR |
|---|---|---|
| Page container | `<Page>` from dewey-ui | hand-rolled `mx-auto max-w-7xl px-5 py-4` on 3 of 4 routes |
| Data layer | `@tanstack/react-query` + `services/` + `query-keys.ts` | `frappe-react-sdk` (SWR), keys built inline as strings |
| Feedback | sonner toasts via `lib/toast.ts` | inline status `Card` banners |
| Chrome | breadcrumbs, live status in header | none |
| Errors | `error-boundary.tsx` mounted at root | **none — any render throw white-screens the app** |
| shadcn style | `new-york` | `radix-nova` |

Two of these are defects rather than differences.

**No error boundary.** `hr_attendance/src/main.tsx` mounts the router with
nothing above it. An unexpected payload shape anywhere in the tree unmounts the
whole SPA to a blank page.

**Writes do not invalidate reads.** `useFrappePostCall` has no relationship to
the read caches — 18 call sites across 7 hook files, each relying on a human to
remember the follow-up `mutate()`. The remembering already fails:
`ClearEmployeeScheduleDialog` succeeds, `WeeklySchedulePage.tsx:356` refreshes
the *schedule* context, and the *attendance* calendar cache
(`useEmployeeCalendar`) is left stale with nothing to invalidate it. The same
page carries a `savedNonce` counter (lines 88/142/240) because
`refreshContext()` alone did not re-seed the form, and four separate
`void refreshContext()` calls (242, 356, 363, 370).

The keys make this expensive to fix in place. `useWeeklySchedule.ts:106` builds

```
`${RESOLVE_METHOD}:${employee}:${effectiveFrom}:${debouncedPatternJson}`
```

— a serialized week pattern embedded in a string. There is no way to express
"everything for this employee".

## Goal

Bring the HR SPA's chrome, data layer, and robustness to ADMS parity, without
altering the attendance domain views.

## Sourcing rule

This rule governs every component decision in this spec, and every component
decision during implementation:

1. If `@lolbikb/dewey-ui` exports it — use it.
2. Otherwise, if the shadcn registry has it — `npx shadcn@latest add <name>`.
3. Otherwise hand-roll, with a comment stating why neither fit.

Verified against the live registry (62 UI components) and dewey-ui v1.11.0's
exports. dewey-ui provides `Page`, `PageHeader`, `Section`, `EmptyState`,
`Breadcrumb*`, `GenericDataTable`. It has **no** `Alert`, `Spinner`, `Field`, or
`Item` — those come from shadcn.

HR's `components.json` moves from `radix-nova` to **`new-york`**, matching ADMS.
This governs newly-added components only; it does not rewrite existing files.
HR has just three local implementations — `date-picker-input.tsx` (74),
`hover-card.tsx` (55), `time-input.tsx` (49). The first and third are bespoke HR
compositions with no registry equivalent and stay as they are. Every other
`components/ui/*` file is already a thin re-export of dewey-ui.

If the shadcn v4 CLI rejects `new-york` as a style value, keep `radix-nova` and
record it — dewey-ui's `theme.css` governs actual appearance either way, so the
visual result is identical and only the generated source differs.

## Out of scope — the domain layer

These keep their exact current markup and classes. The refactor happens *around*
them:

`DayTimeline`, `WeekView`, `WeekDayView`, `DayChips`, `WeekScheduleGantt`,
`WeekPatternGroupEditor`, `DayInspectorSheet`, `FlagDetailPanel`,
`WeekFlagSummary`, `EmployeeAvatar`, `MobileTabBar`, everything in `lib/` that
is domain math (`attendancePunches`, `clockDay`, `weekCalendar`,
`shiftTimeline`, `lunchDetection`, `scheduleCoverage`, …), and all of `brand/`.

Their internal dashed-border empty states (`WeekPatternGroupEditor.tsx:97`,
`WeekScheduleGantt.tsx:196`) are domain visuals and are **not** converted to
`EmptyState`. Only the four generic ones are (see Chrome).

## Architecture

### Data layer

Four new modules, mirroring ADMS's shape:

- **`lib/frappe.ts`** — the transport.
  ```ts
  export async function frappeCall<T>(
    method: string,
    params?: Record<string, unknown>,
    init?: { method?: "GET" | "POST" },
  ): Promise<T>
  ```
  Calls `/api/method/<dotted.path>`, sends `credentials: "include"`, sets
  `X-Frappe-CSRF-Token` from `window.csrf_token` on POST only, unwraps the
  `{message: T}` envelope, and throws a typed error built by the existing
  `lib/frappeError.ts` extractor.

  `window.csrf_token` is already injected by every HTML entry
  (`www/hr-attendance.html:23`, `www/hr-schedule.html:23`, `www/adms.html:9`),
  so no server-side change is needed.

- **`lib/queryKeys.ts`** — array-key registry. Keys are hierarchical so that
  invalidation works by prefix: `queryKeys.schedule.context(emp)` must begin
  with `queryKeys.schedule.all`. That property is what makes invalidation
  correct by construction rather than by diligence, so it is asserted in tests.

- **`lib/queryClient.ts`** — ADMS's configuration verbatim: `staleTime: 0`,
  `gcTime: 5min`, `refetchOnWindowFocus`, `refetchOnReconnect`, `retry: 2` with
  exponential backoff capped at 30s; mutations `retry: 1`.

- **`services/{calendar,schedule,coverage,import,engine}.ts`** — plain async
  functions over `frappeCall`, with typed arguments and returns. No React.

`lib/frappe.ts` is written inline in the main session, not delegated to a
subagent: it is auth-adjacent, and a plausible-looking wrong answer there passes
review.

### Migration order

**The route is the unit of work, not the layer.** Each step below converts one
route completely — its data layer, its chrome, and its feedback — so that every
page file is opened once rather than three times, and so each route reaches its
final state before the next begins. The Chrome and Feedback sections below
describe *what* each conversion does, not separate passes.

One route at a time, because both providers can coexist and the transport
should be proven on one route before three others depend on it:

1. **`/hr-schedule`** — the worst offender. Deletes `savedNonce` and all four
   `void refreshContext()` calls, and fixes the stale-calendar bug by
   invalidating `queryKeys.calendar.all` alongside `queryKeys.schedule.all`.
2. `/hr-schedule/import`
3. `/hr-schedule/coverage`
4. `/hr-attendance`

Then `frappe-react-sdk` and `FrappeProvider` are removed from `main.tsx`.

**`useFrappeAuth` is swapped last, on its own.** It gates sign-in on all four
routes; replacing it is a distinct change with a distinct verification pass, not
a rider on route 4.

### Chrome

Every route becomes `<Page>` → `<PageHeader title description actions>` →
`<Section grow>`, deleting the hand-rolled `mx-auto max-w-7xl px-5 py-4`
wrappers. dewey-ui's own comment states `Page` "owns ALL page padding … the
single source of page insets across both apps".

`HrAppShell` gains breadcrumbs, following ADMS's pattern: Attendance ·
Schedule · Schedule › Import · Schedule › Coverage.

By the sourcing rule:

| Replacement | Source | Sites |
|---|---|---|
| `EmptyState` | dewey-ui | `App.tsx:352`, `WeeklySchedulePage.tsx:429`, `ClearEmployeeScheduleDialog.tsx:226,250` |
| `Alert` | shadcn (new) | ~30 hand-rolled banner class strings |
| `Spinner` | shadcn (new) | 26 `Loader2Icon animate-spin` sites |
| `Field` | shadcn (new) | effective-from / generate-through footer group, `WeeklySchedulePage.tsx:495-542` |
| `Item` | shadcn (new) | confirm-plan list `WeeklySchedulePage.tsx:650-662`, `ResolvePlanGroupsList` |
| `Breadcrumb` | dewey-ui re-export shim | `HrAppShell` |

### Feedback

`lib/toast.ts` mirroring ADMS's helper set (`notifySuccess`, `notifyError`,
`notifyInfo`, `notifyWarning`, `notifyOperationFailed`).

The split is between events and state, not between old and new:

- Mutation **outcomes** become toasts. The save-success banner becomes a toast
  carrying an "Open attendance" action — sonner supports actions, so the link is
  not lost.
- Persistent **state** banners stay inline as `Alert`s: the ineligible-employee
  notice and "Editing X's schedule". These are conditions that remain true while
  the user reads them; a toast would be the wrong shape.

### Robustness

`components/error-boundary.tsx`, copied from ADMS, mounted in `main.tsx` around
the router. Lifting it into dewey-ui would be better but is deliberately a
follow-up: it means a cross-repo publish and a version bump in both apps.

Per-route `isError` states render as an `Alert` inside `<Section>`, replacing
today's silent-failure paths. Retry-with-backoff and refetch-on-focus/reconnect
arrive with the QueryClient.

## Testing

**The runner stays `tsx --test`.** ADMS uses vitest, but switching runners is
orthogonal churn, and the existing 197 unit + 18 e2e tests are exactly the
safety net this refactor depends on — they must run unchanged throughout. This
is a deliberate departure from parity.

New tests:

- `lib/frappe.test.ts` — `X-Frappe-CSRF-Token` present on POST and absent on
  GET; `{message}` unwrapping; error extraction from `_server_messages` / `exc`.
- `lib/queryKeys.test.ts` — every specific key begins with its family's `all`
  prefix. This is the property invalidation correctness rests on.
- A source pin asserting no manual-refetch counter (`savedNonce` and kin)
  returns.

**The regression gate is Playwright green after each route migration**, not at
the end. A pure-refactor branch produces no visible change to eyeball, so the
e2e suite is the only thing standing between a silent break and production.

## Risks

**This is a large refactor with no user-visible feature.** ~1,400 lines of hooks
across 13 files, four routes. Pure-refactor branches are where regressions hide,
because a test written against the old contract gets "adjusted" to pass instead
of being allowed to fail. Mitigation: route-by-route, e2e green at every step,
and no test edited in the same commit as the code it covers.

**`<Page>`/`<PageHeader>` will shift spacing on every route.** dewey-ui owns
different insets than the current hand-rolled `px-5 py-4`. Expect small visual
diffs on pages nobody asked to change. Each route is verified in a browser
rather than from source — the clock-based-attendance branch (2026-07-27) shipped
a timeline colour bug that three review layers cleared by reading source and
only a rendered page caught.

**`useFrappeAuth` removal touches the sign-in gate on all four routes.** Handled
by sequencing it last and alone.

## Known follow-ups (not in this work)

- **`ResponsiveModal` (HR) vs `base-modal.tsx` (ADMS, 133 lines)** — two
  hand-rolled solutions to the same adaptive-modal problem. HR's came out of the
  mobile-surfaces work (#65) and is tuned to it. Converging them, most likely
  into dewey-ui, is worth doing separately.
- **Lifting `ErrorBoundary` into dewey-ui** so both apps consume one.
- **Bringing ADMS onto `PageHeader`/`Section`/`EmptyState`** — it uses only
  `Page` today, so after this work HR is ahead of ADMS on shared-primitive use.
- **`hover-card.tsx`** — a plain registry component currently living as a
  radix-nova local implementation; could be re-added under new-york.

## Files touched

| File | Change |
|---|---|
| `frontend/hr_attendance/components.json` | style → `new-york` |
| `frontend/hr_attendance/package.json` | add `@tanstack/react-query`; drop `frappe-react-sdk` at the end |
| `src/lib/frappe.ts` | new — transport (written inline, not delegated) |
| `src/lib/queryKeys.ts` | new — array-key registry |
| `src/lib/queryClient.ts` | new — ADMS's QueryClient config |
| `src/services/*.ts` | new — 5 service modules |
| `src/lib/toast.ts` | new — ADMS's notify helpers |
| `src/components/error-boundary.tsx` | new — copied from ADMS |
| `src/components/ui/{alert,spinner,field,item,breadcrumb}.tsx` | new — shadcn / dewey-ui shim |
| `src/hooks/*.ts` | 13 files — rewritten as react-query hooks over `services/` |
| `src/main.tsx` | QueryClientProvider, ErrorBoundary, drop FrappeProvider |
| `src/ui/HrAppShell.tsx` | breadcrumbs |
| `src/ui/App.tsx`, `WeeklySchedulePage.tsx`, `schedule-import/ScheduleImportPage.tsx`, `schedule-coverage/ScheduleCoveragePage.tsx` | Page/PageHeader/Section; Alert/Spinner/EmptyState/Field/Item; toasts |
| `src/ui/AttendanceLoading.tsx` | Spinner swap only — skeleton shapes are domain and stay |

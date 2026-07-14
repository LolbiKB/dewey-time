# hr_attendance mobile surfaces — design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/hr-attendance-mobile-surfaces`

## Motivation

A `dewey-app-feel` audit of the `hr_attendance` SPA (2026-07-14) found the app's
*foundations* are reference-grade (frame lock, density, motion substrate, capability
gating) but that it drifts from the skill on the **mobile surface layer** — the three
places a phone user actually feels it. The skill's own sibling-state table marks
hr_attendance "✓ Full stack" on the touch layer; that claim is stale. This spec covers
the three confirmed HIGH findings:

- **P3-a** — the primary week attendance grid is a 7-column
  `grid-cols-[repeat(7,minmax(8rem,1fr))]` (`WeekView.tsx:121,229`) inside
  `overflow-x-auto` (`:120`): a ~896px hard minimum, so on any phone the core screen
  horizontally scrolls (the web-page tell P3.3 forbids). The loading skeleton mirrors it
  (`AttendanceLoading.tsx:43-59`) and h-scrolls too.
- **P4-a** — no adaptive modal exists. Seven quick-decision surfaces import `Dialog`
  directly and never branch on device, so each renders as a centered floating card on a
  phone instead of a bottom sheet. `useIsMobile` is used only for nav, never to pick a
  surface.
- **P4-b** — the two `Sheet` surfaces (`DayInspectorSheet.tsx:99`,
  `WeeklyScheduleSheet.tsx:65`) are hard-coded `side="right"`, so on a phone the primary
  HR-review drawer slides in from the right edge as a ¾-width panel rather than docking
  from the bottom.

## Goals

1. The week attendance screen never horizontally scrolls on a phone; it presents a
   **single-day view with a day switcher** that preserves the full per-day timeline.
2. Every quick-decision dialog renders as a centered `Dialog` on desktop and a bottom
   `Sheet` on mobile, through one shared `ResponsiveModal` wrapper.
3. The two detail sheets dock from the bottom on mobile and from the right on desktop.
4. No regression to any desktop layout or behavior.

## Non-goals (YAGNI)

- **Swipe-to-change-day** on the phone week view — the pip strip + chevrons suffice for
  v1; deferred.
- **URL / cross-session persistence** of the selected day — local component state,
  resets to today-or-first when the visible week changes.
- **Routing the two detail sheets through `ResponsiveModal`** — they are detail drawers,
  not quick-decision modals; they only get their `side` driven by `useIsMobile()`.
- All other MED/LOW audit items (nav guard, badge role-awareness, route transition,
  empty states, etc.) — separate follow-ups.

## App class

`hr_attendance` is a **declared native-feel PWA** (installable, `MobileTabBar`,
safe-area shell). The full P3/P4 touch layer applies. (Declaring the class in a
`DESIGN.md` is audit item NN-1 and out of scope here.)

---

## Component 1 — `ResponsiveModal` (P4-a)

**New file:** `src/components/ResponsiveModal.tsx` (a composite primitive that sits above
`src/components/ui/*` but is not a screen — mirrors GAR's `components/ResponsiveModal.tsx`,
own take).

### API (controlled, prop-based)

```ts
type ResponsiveModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;      // body — scrollable region
  footer?: React.ReactNode;       // action row — pinned
  className?: string;             // extra classes on the content element
  size?: "sm" | "md" | "lg";      // desktop Dialog width; default "md"
};
```

Prop-based (not sub-components) because the P4.1 rule describes exactly this shape:
"maps the same title/description/children/footer onto a Sheet on mobile and a Dialog on
desktop."

### Behavior

- `const isMobile = useIsMobile()` selects the surface.
- **Mobile** → `Sheet` + `SheetContent side="bottom"`:
  - `onOpenAutoFocus={(e) => e.preventDefault()}` (suppress keyboard pop — P1-c).
  - `className`: `rounded-t-2xl`, `flex flex-col`, `max-h-[min(85dvh,42rem)]`,
    `pb-[env(safe-area-inset-bottom)]`.
  - `SheetHeader`/`SheetTitle`/`SheetDescription` from `title`/`description`.
  - Body: `<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>`.
  - Footer: `SheetFooter` (only when `footer` provided).
- **Desktop** → `Dialog` + `DialogContent`:
  - `className`: `flex flex-col`, `max-h-[min(85dvh,42rem)]`, size → width
    (`sm:max-w-sm|lg|2xl`), plus caller `className`.
  - `DialogHeader`/`DialogTitle`/`DialogDescription`, the same
    `min-h-0 flex-1 overflow-y-auto` body, `DialogFooter` when present.

### Ownership / bonus cleanups

Because the wrapper owns the caps and inset, migrating a dialog to it also retires that
dialog's ad-hoc `max-h` (P1-d/e) and re-typed `px-5 py-4` (P2-b), and adds the missing
autofocus suppression (P1-c) — for the seven migrated surfaces only.

### Migration targets (7)

Replace the `Dialog`/`DialogContent`/`DialogHeader`/`DialogFooter` scaffolding with a
`ResponsiveModal`; the body content is unchanged.

| File | Notes |
|---|---|
| `src/ui/ClearAllSchedulesDialog.tsx` | already controlled |
| `src/ui/ClearEmployeeScheduleDialog.tsx` | already controlled |
| `src/ui/ClearSitePatternsDialog.tsx` | already controlled |
| `src/ui/RunEngineDialog.tsx` | already controlled |
| `src/ui/SchedulePlanPreviewDialog.tsx` | uses a `DialogTrigger` → convert to explicit trigger button + `open` state |
| `src/ui/WeeklyScheduleTemplatePickerDialog.tsx` | uses a `DialogTrigger` → same |
| `src/ui/WeeklySchedulePage.tsx` (inline confirm, `:597`) | already controlled (`confirmOpen`) |

`ResponsiveModal` is controlled-only; the two `DialogTrigger` callers switch to an
explicit button that flips their existing open state.

---

## Component 2 — Phone week-day view (P3-a)

### `src/lib/weekDayView.ts` (pure, unit-tested first — TDD)

- `initialSelectedDate(weekDates: Date[], today: Date): string` — `yyyy-MM-dd` of today
  if today is within `weekDates`, else the first day.
- `stepDay(weekDates: Date[], currentKey: string, dir: -1 | 1): string` — clamped to the
  week ends (no wrap).
- `dayPipState(day: Day | undefined, isToday: boolean): "today" | "holiday" | "off" | "flagged" | "normal"`
  — precedence for the pip strip (used to color each pip).

### `src/ui/WeekDayView.tsx`

Same props as `WeekView` (`weekDates`, `daysByDate`, `alertsByDate`, `syncByDate`,
`onInspectDay`, `onInspectFlag`).

- Local state `selectedKey`, seeded via `initialSelectedDate`. An effect keyed on the
  week (its first date) reseeds to today-or-first when the visible week changes.
- **Header:** `‹` / `›` chevrons (`stepDay`, disabled at ends) + selected-day label
  (`EEE d`) + a 7-pip strip. Each pip is a small button colored by `dayPipState`, the
  active day highlighted; tapping a pip selects that day.
- **Body:** one full-width `DayCell` for `selectedKey`, using the **shared week time
  window** so the vertical axis is stable as days switch and matches desktop.
- **Chips:** the selected day's leave / off-shift / device-alert chips reuse WeekView's
  chip logic via a new extracted `DayChips` component (`src/ui/DayChips.tsx`) consumed by
  both `WeekView`'s header cell and `WeekDayView`'s header, so the chip set cannot drift.

### Shared time-window hook

Extract the `computeWeekTimelineWindow(mins)` derivation currently inline in
`WeekView.tsx:78-108` into a `useWeekTimelineWindow(weekDates, daysByDate)` hook in
`src/lib/attendancePunches.ts` (where `computeWeekTimelineWindow` already lives),
consumed by **both** `WeekView` and `WeekDayView`, so there is one source of the axis
window (no duplication).

### `src/ui/App.tsx`

Fork the render: `const isMobile = useIsMobile(); … {isMobile ? <WeekDayView … /> : <WeekView … />}`.
The desktop grid path is byte-unchanged.

### `src/ui/AttendanceLoading.tsx`

Add a mobile skeleton variant (pip-strip placeholder + single-day timeline skeleton) and
select it under `isMobile`, so the loading state does not h-scroll either. Desktop
`WeekViewSkeleton` unchanged.

---

## Component 3 — Sheets dock to bottom on mobile (P4-b)

For `src/ui/DayInspectorSheet.tsx` and `src/ui/WeeklyScheduleSheet.tsx`:

- Import `useIsMobile`; set `side={isMobile ? "bottom" : "right"}`.
- Add `onOpenAutoFocus={(e) => e.preventDefault()}` (P1-c).
- Fork the content classes: **desktop right** keeps its width
  (normalize the dead `w-[440px]` from P3-d to `w-full sm:w-[440px] sm:max-w-md`);
  **mobile bottom** uses `w-full max-h-[min(90dvh,44rem)] rounded-t-2xl` with the
  existing internal scroll region.

These remain detail drawers; they are **not** migrated to `ResponsiveModal`.

---

## Testing

- **TDD:** write `src/lib/weekDayView.test.ts` first — `initialSelectedDate` (in-week vs
  out-of-week), `stepDay` (clamping at both ends), `dayPipState` precedence.
- **Component tests** (vitest + testing-library, mocking `useIsMobile`):
  - `src/components/ResponsiveModal.test.tsx` — mobile → `SheetContent[side=bottom]` and
    `onOpenAutoFocus` prevented; desktop → `DialogContent`; title/description/footer
    render in both.
  - `src/ui/WeekDayView.test.tsx` — renders the selected day; pip tap and chevron change
    the day; chevrons disable/clamp at week ends.
- **e2e (Playwright):** extend the existing walk (`e2e/audit-walk.spec.ts` pattern) with a
  phone-viewport case asserting (a) `documentElement.scrollWidth <= clientWidth` on the
  week screen (no h-scroll) and (b) a confirm dialog opens as a bottom sheet
  (`[data-slot=sheet-content][data-side=bottom]`).
- **Regression:** all existing desktop unit + e2e specs stay green (desktop paths
  unchanged by construction).

---

## Suggested build sequence

1. `ResponsiveModal` + its test, then migrate the 7 dialogs (independent, mechanical).
2. Shared time-window util extraction (refactor, desktop-safe).
3. `weekDayView.ts` (TDD) → `WeekDayView.tsx` → `App.tsx` fork → mobile loading skeleton.
4. Component 3 sheet re-siding.
5. e2e phone-viewport walk last, over the finished surfaces.

## Risks / watch-items

- **`DayInspectorSheet` bottom layout** — it has internal tabs + its own scroll; the
  bottom variant needs a height cap so the tab body scrolls within the sheet rather than
  the sheet growing past the viewport. Verify on a real narrow viewport.
- **Shared-window extraction** must be a pure refactor — snapshot/verify the desktop
  `WeekView` axis is identical before/after.
- **`DialogTrigger` → controlled** migration for the two trigger-based dialogs must keep
  their open/close semantics (including any focus-return behavior).

# hr_attendance Mobile Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three HIGH dewey-app-feel audit findings for `hr_attendance` — adaptive dialogs (P4-a), a phone-friendly single-day week view (P3-a), and bottom-docking detail sheets (P4-b).

**Architecture:** Introduce one `ResponsiveModal` wrapper (Dialog on desktop, bottom Sheet on mobile) and migrate the seven quick-decision dialogs to it. Add a phone-only single-day `WeekDayView` (day switcher + one full-width `DayCell`) that `App.tsx` renders under `useIsMobile()` instead of the 7-column desktop `WeekView`, backed by a shared time-window hook and an extracted `DayChips` component. Re-side the two detail sheets to dock from the bottom on mobile. Desktop paths stay byte-unchanged.

**Tech Stack:** React 19 + TypeScript + Vite, TailwindCSS v4, `@lolbikb/dewey-ui` (Radix-based Dialog/Sheet primitives, `AppShell`, `Page`), `date-fns` v4, `react-router-dom` v7. Tests run via `tsx --test` (Node's `node:test`) using `renderToStaticMarkup` smoke checks + source-string assertions; e2e via Playwright.

## Global Constraints

- **Frontend package root:** `dewey_time/frontend/hr_attendance`. All `src/…` paths below are relative to it. Run all `npm`/`npx` commands from this directory.
- **Test runner:** `npm run test:web` = `tsx --test` over `src/lib/*.test.ts src/brand/*.test.ts src/brand/*.test.tsx src/pwa/*.test.ts src/pwa/*.test.tsx`. This glob does **not** cover `src/components` or `src/ui` — Task 1 extends it. Focused run: `npx tsx --test src/<path>.test.ts(x)`.
- **Test idiom:** No jsdom / testing-library / vitest. Component tests use `renderToStaticMarkup(<C/>)` + regex on the HTML, and/or `readFileSync(source)` + regex on the source. Follow `src/pwa/responsiveShell.test.tsx` and `src/brand/DeweyTimeIntro.test.tsx` exactly.
- **Mobile breakpoint:** `useIsMobile()` (`src/hooks/useIsMobile.ts`) is `< 768px` (Tailwind `md`). Any CSS toggle that must align with it uses `md:` (mobile-only = `md:hidden`, desktop-only = `hidden md:flex`).
- **Primitive imports:** always import Dialog/Sheet from the local shims `@/components/ui/dialog` and `@/components/ui/sheet` (never directly from `@lolbikb/dewey-ui`).
- **Overlay caps:** bounded overlays cap at `max-h-[min(<dvh>,<rem>)]` (never plain `vh`).
- **Commit style:** end each commit body with the Co-Authored-By trailer used in this repo: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Conventional-commit subjects (`feat:` / `refactor:` / `test:`).
- **Branch:** `feat/hr-attendance-mobile-surfaces` (already created).
- **Desktop is frozen:** `WeekView.tsx`'s 7-column grid, all desktop dialog rendering, and the right-side desktop sheets must render identically before and after. Refactor tasks that touch shared code (Tasks 5, 6) must be pure — verify desktop output is unchanged.
- **Do not** add swipe-to-change-day or URL/cross-session persistence of the selected day (explicit non-goals).

---

## File Structure

**Create:**
- `src/components/ResponsiveModal.tsx` — adaptive Dialog(desktop)/Sheet-bottom(mobile) wrapper.
- `src/components/ResponsiveModal.test.tsx` — SSR smoke + source assertions.
- `src/lib/weekTimelineWindow.ts` — pure: collect timeline minutes + resolve the shared axis window.
- `src/lib/weekTimelineWindow.test.ts` — unit tests for the pure functions.
- `src/hooks/useWeekTimelineWindow.ts` — memoized hook wrapping the pure resolver.
- `src/ui/DayChips.tsx` — leave / off-shift / device-alert chip row (extracted from `WeekView`).
- `src/lib/weekDayView.ts` — pure: initial day, step day, pip state.
- `src/lib/weekDayView.test.ts` — unit tests.
- `src/ui/WeekDayView.tsx` — phone single-day view (day switcher + one `DayCell`).
- `src/ui/WeekDayView.test.tsx` — SSR smoke + source assertions.
- `src/ui/dialogMigration.test.tsx` — regression guard that the seven dialogs use `ResponsiveModal`.
- `e2e/mobile-surfaces.spec.ts` — phone-viewport Playwright walk.

**Modify:**
- `package.json` — extend the `test:web` glob.
- `src/ui/RunEngineDialog.tsx`, `src/ui/ClearAllSchedulesDialog.tsx`, `src/ui/ClearEmployeeScheduleDialog.tsx`, `src/ui/ClearSitePatternsDialog.tsx`, `src/ui/SchedulePlanPreviewDialog.tsx`, `src/ui/WeeklyScheduleTemplatePickerDialog.tsx`, `src/ui/WeeklySchedulePage.tsx` — migrate to `ResponsiveModal`.
- `src/ui/WeekView.tsx` — consume the shared window hook + `DayChips` (desktop output unchanged).
- `src/ui/App.tsx` — fork `WeekDayView` vs `WeekView` on `useIsMobile()`.
- `src/ui/AttendanceLoading.tsx` — make `WeekViewSkeleton` responsive (mobile single-day skeleton).
- `src/ui/DayInspectorSheet.tsx`, `src/ui/WeeklyScheduleSheet.tsx` — dock bottom on mobile.

---

## Task 1: `ResponsiveModal` wrapper + test wiring

**Files:**
- Modify: `package.json` (scripts.test:web)
- Create: `src/components/ResponsiveModal.tsx`
- Test: `src/components/ResponsiveModal.test.tsx`

**Interfaces:**
- Consumes: `useIsMobile` from `@/hooks/useIsMobile`; Dialog/Sheet primitives from the shims; `cn` from `@/lib/utils`.
- Produces:
  ```ts
  type ResponsiveModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: React.ReactNode;
    description?: React.ReactNode;
    children: React.ReactNode;          // body — the wrapper scrolls it, adds NO padding by default
    footer?: React.ReactNode;
    size?: "sm" | "md" | "lg";          // desktop Dialog width; default "md"
    showCloseButton?: boolean;          // desktop close X; default true
    className?: string;                 // extra classes on the Content element
    headerClassName?: string;           // override header padding/border
    bodyClassName?: string;             // override the scroll region (e.g. "p-0" default already bare)
    footerClassName?: string;
  };
  export function ResponsiveModal(props: ResponsiveModalProps): JSX.Element;
  ```

- [ ] **Step 1: Extend the test glob so `src/components` and `src/ui` tests run**

In `package.json`, replace the `test:web` script (line 10):

```json
    "test:web": "tsx --test src/lib/*.test.ts src/brand/*.test.ts src/brand/*.test.tsx src/pwa/*.test.ts src/pwa/*.test.tsx src/components/*.test.tsx src/ui/*.test.tsx",
```

- [ ] **Step 2: Write the failing test**

Create `src/components/ResponsiveModal.test.tsx`:

```tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ResponsiveModal } from "./ResponsiveModal";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("ResponsiveModal renders nothing when closed (SSR-safe, portal not mounted)", () => {
  const html = renderToStaticMarkup(
    <ResponsiveModal open={false} onOpenChange={() => {}} title="Confirm">
      <p>body</p>
    </ResponsiveModal>,
  );
  assert.equal(html, "", "closed modal mounts no portal content");
});

test("ResponsiveModal is adaptive: Dialog on desktop, bottom Sheet on mobile", () => {
  const src = readFileSync(resolve(PKG, "src/components/ResponsiveModal.tsx"), "utf8");
  assert.match(src, /useIsMobile/, "surface chosen from the sync mobile hook");
  assert.match(src, /side="bottom"/, "mobile leg is a bottom sheet");
  assert.match(src, /onOpenAutoFocus=\{\(e\) => e\.preventDefault\(\)\}/, "mobile suppresses autofocus (no keyboard pop)");
  assert.match(src, /max-h-\[min\(85dvh,42rem\)\]/, "bounded height cap with dvh + rem");
  assert.match(src, /env\(safe-area-inset-bottom\)/, "mobile sheet pads the home indicator");
  assert.match(src, /rounded-t-2xl/, "mobile sheet has a rounded top");
  assert.match(src, /SheetTitle/, "renders SheetTitle on the mobile leg");
  assert.match(src, /DialogTitle/, "renders DialogTitle on the desktop leg");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/components/ResponsiveModal.test.tsx`
Expected: FAIL — `Cannot find module './ResponsiveModal'`.

- [ ] **Step 4: Implement `ResponsiveModal`**

Create `src/components/ResponsiveModal.tsx`:

```tsx
import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";

const SIZE_MAXW: Record<"sm" | "md" | "lg", string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
};

export type ResponsiveModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  showCloseButton?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
};

// One adaptive quick-decision surface: a centered Dialog on desktop, a rounded-top,
// safe-area-padded bottom Sheet on mobile. Title/description/footer map onto the
// surface-specific primitives so the correct <…Title> lands in the correct context.
// The body is scrolled but NOT padded by the wrapper — callers keep their own section
// padding (matches the existing dialogs' `p-0` content + padded inner sections).
export function ResponsiveModal(props: ResponsiveModalProps) {
  const isMobile = useIsMobile();
  const size = props.size ?? "md";

  if (isMobile) {
    return (
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent
          side="bottom"
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "flex max-h-[min(85dvh,42rem)] flex-col gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]",
            props.className,
          )}
        >
          <SheetHeader className={cn("space-y-1.5 px-5 py-4 text-left", props.headerClassName)}>
            <SheetTitle>{props.title}</SheetTitle>
            {props.description ? <SheetDescription>{props.description}</SheetDescription> : null}
          </SheetHeader>
          <div className={cn("min-h-0 flex-1 overflow-y-auto", props.bodyClassName)}>
            {props.children}
          </div>
          {props.footer ? (
            <SheetFooter className={cn("gap-2 px-5 py-4", props.footerClassName)}>
              {props.footer}
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={props.showCloseButton ?? true}
        className={cn(
          "flex max-h-[min(85dvh,42rem)] flex-col gap-0 p-0",
          SIZE_MAXW[size],
          props.className,
        )}
      >
        <DialogHeader className={cn("space-y-1.5 px-5 py-4 text-left", props.headerClassName)}>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
        </DialogHeader>
        <div className={cn("min-h-0 flex-1 overflow-y-auto", props.bodyClassName)}>
          {props.children}
        </div>
        {props.footer ? (
          <DialogFooter className={cn("gap-2 px-5 py-4", props.footerClassName)}>
            {props.footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --test src/components/ResponsiveModal.test.tsx`
Expected: PASS (2 tests). If the SSR-closed test renders non-empty, confirm the dewey-ui Dialog/Sheet do not render portal content when `open={false}` (they should not).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json src/components/ResponsiveModal.tsx src/components/ResponsiveModal.test.tsx
git commit -m "feat(hr-attendance): add ResponsiveModal (Dialog on desktop, bottom Sheet on mobile)

Fixes P4-a foundation. Extends the test:web glob to cover src/components and src/ui.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migrate `RunEngineDialog` to `ResponsiveModal` (worked example)

This is the full worked migration; Tasks 3–4 apply the identical transform.

**Files:**
- Modify: `src/ui/RunEngineDialog.tsx`

**Interfaces:**
- Consumes: `ResponsiveModal` (Task 1). No props change on `RunEngineDialog` itself.
- Produces: nothing new.

**Transform rule (applies to every migration):** the trigger button stays outside the modal; `<Dialog open onOpenChange>` + `<DialogContent>` becomes `<ResponsiveModal open onOpenChange title=… description=… footer=…>`; the existing `<DialogHeader>` title/description children move into the `title`/`description` props; the body JSX (everything between header and footer) stays verbatim as `children`; any `<DialogFooter>` children move into the `footer` prop. Do not keep any `Dialog*`/`Sheet*` primitive inside `children`.

- [ ] **Step 1: Swap imports**

In `src/ui/RunEngineDialog.tsx`, replace the dialog import block (lines 6–13) with:

```tsx
import { ResponsiveModal } from "@/components/ResponsiveModal";
```

Keep the `AppTooltip`, `Button`, `Input`, `Label`, `Separator`, `DatePickerInput` imports. Remove the now-unused `DialogTrigger` usage (handled below).

- [ ] **Step 2: Replace the render (lines 92–211)**

`RunEngineDialog` uses an internal trigger (the `FlagIcon` ghost button). Keep it as a plain button that opens the modal. Replace the whole `return (...)` block with:

```tsx
  return (
    <>
      <AppTooltip content="Run flag engine (dev)" side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          disabled={props.disabled || !props.employee}
          aria-label="Run flag engine"
          onClick={() => setOpen(true)}
        >
          <FlagIcon className="size-4" />
        </Button>
      </AppTooltip>

      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        size="md"
        title="Run flag engine"
        description="Backfill AUTO flags from checkins and shift assignments. Re-running closeout is safe — only AUTO rows are replaced."
        headerClassName="space-y-2 px-5 pt-5 pr-12"
      >
        <div className="space-y-4 px-5 py-4">
          {/* …employee card + date range + status — UNCHANGED from the current lines 119–171… */}
        </div>

        <Separator />

        <div className="space-y-3 px-5 py-4">
          {/* …mode buttons — UNCHANGED from the current lines 177–208… */}
        </div>
      </ResponsiveModal>
    </>
  );
```

Preserve the two inner `<div>` bodies (current lines 118–172 and 176–209) verbatim — only the `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogTrigger` wrappers are removed. The `<Separator />` stays between the two body sections.

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit && npm run test:web`
Expected: no TS errors; all tests pass.

- [ ] **Step 4: Manual sanity (dev server, optional but recommended)**

Run `npm run dev:hr`, open the toolbar's flag-engine button on a desktop width (centered dialog) and a phone width (`< 768px`, bottom sheet). Confirm both open, the date pickers work, and the sheet clears the home indicator.

- [ ] **Step 5: Commit**

```bash
git add src/ui/RunEngineDialog.tsx
git commit -m "refactor(hr-attendance): migrate RunEngineDialog to ResponsiveModal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migrate the three `Clear*` dialogs

**Files:**
- Modify: `src/ui/ClearAllSchedulesDialog.tsx`, `src/ui/ClearEmployeeScheduleDialog.tsx`, `src/ui/ClearSitePatternsDialog.tsx`

**Interfaces:**
- Consumes: `ResponsiveModal` (Task 1). These dialogs are already controlled (`open` + `handleOpenChange`).
- Produces: nothing new.

Each has bespoke chrome: a `DialogHeader` with `border-b border-border/60 px-5 py-4` and a `DialogFooter` with `border-t border-border/60 bg-muted/50 px-5 py-4 sm:justify-end`. Preserve that look via `headerClassName` / `footerClassName`.

- [ ] **Step 1: `ClearAllSchedulesDialog.tsx` — swap imports**

Replace the dialog import block (lines 18–25) with:

```tsx
import { ResponsiveModal } from "@/components/ResponsiveModal";
```

- [ ] **Step 2: `ClearAllSchedulesDialog.tsx` — replace the wrapper (lines 120–343)**

- Replace `<Dialog open={open} onOpenChange={handleOpenChange}>` + `<DialogContent …>` (lines 120–124) with:

```tsx
      <ResponsiveModal
        open={open}
        onOpenChange={handleOpenChange}
        size="md"
        title={<span className="text-base">Nuclear clear — all employees</span>}
        description={/* the existing <DialogDescription> children (current lines 132–136), verbatim */}
        headerClassName="space-y-2 border-b border-border/60 px-5 py-4 text-left"
        footer={/* the existing <DialogFooter> children (current lines 316–340), verbatim */}
        footerClassName="mx-0 mb-0 shrink-0 gap-2 border-t border-border/60 bg-muted/50 px-5 py-4 sm:justify-end"
      >
```

- Delete the old `<DialogHeader>` … `</DialogHeader>` (lines 125–137) — its title becomes the `title` prop and its description becomes `description`. If the header contains an icon/badge alongside the title, pass that whole node as `title`.
- Keep the scroll body (everything that was between `</DialogHeader>` and `<DialogFooter>`) as the `children`.
- Delete the old `<DialogFooter>` … `</DialogFooter>` (lines 315–341) — its buttons become the `footer` prop.
- Replace the closing `</DialogContent></Dialog>` (lines 342–343) with `</ResponsiveModal>`.

- [ ] **Step 3: `ClearEmployeeScheduleDialog.tsx` — same transform**

Imports at lines 16–23 → `import { ResponsiveModal } from "@/components/ResponsiveModal";`. Wrapper at lines 135–368: `title={<span className="text-base">Clear schedule data</span>}`, `description=` the existing DialogDescription children (lines 147–151), `headerClassName="space-y-2 border-b border-border/60 px-5 py-4 text-left"`, `footer=` the existing DialogFooter children (lines 341–366), `footerClassName="mx-0 mb-0 shrink-0 gap-2 border-t border-border/60 bg-muted/50 px-5 py-4 sm:justify-end"`. Body between old header and footer preserved verbatim.

- [ ] **Step 4: `ClearSitePatternsDialog.tsx` — same transform**

Imports at lines 15–22 → `import { ResponsiveModal } from "@/components/ResponsiveModal";`. Wrapper at lines 125–357: `title={<span className="text-base">Nuclear wipe — site patterns</span>}`, `description=` the existing DialogDescription children (lines 137–141), `headerClassName="space-y-2 border-b border-border/60 px-5 py-4 text-left"`, `footer=` the existing DialogFooter children (lines 330–355), `footerClassName="mx-0 mb-0 shrink-0 gap-2 border-t border-border/60 bg-muted/50 px-5 py-4 sm:justify-end"`. Body preserved verbatim.

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit && npm run test:web`
Expected: no TS errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/ClearAllSchedulesDialog.tsx src/ui/ClearEmployeeScheduleDialog.tsx src/ui/ClearSitePatternsDialog.tsx
git commit -m "refactor(hr-attendance): migrate Clear* dialogs to ResponsiveModal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Migrate the remaining three surfaces + regression guard

**Files:**
- Modify: `src/ui/SchedulePlanPreviewDialog.tsx`, `src/ui/WeeklyScheduleTemplatePickerDialog.tsx`, `src/ui/WeeklySchedulePage.tsx`
- Test: `src/ui/dialogMigration.test.tsx`

**Interfaces:**
- Consumes: `ResponsiveModal` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: `SchedulePlanPreviewDialog.tsx` (controlled, no footer)**

Imports at lines 4–10 → `import { ResponsiveModal } from "@/components/ResponsiveModal";`. Replace `<Dialog open={props.open} onOpenChange={props.onOpenChange}>` + `<DialogContent … sm:max-w-lg" showCloseButton>` (lines 36–37) with:

```tsx
    <ResponsiveModal
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="md"
      title={<span className="text-base">Weekly schedule preview</span>}
      description={/* existing <DialogDescription className="text-xs"> children, lines 45–54, verbatim */}
      headerClassName="space-y-1 border-b border-border/60 px-5 py-4 text-left"
    >
```

Preserve the body (lines 58–95) verbatim as children; replace `</DialogContent></Dialog>` (lines 96–97) with `</ResponsiveModal>`. (`SchedulePreviewTrigger` at line 205 is a separate exported component — leave it untouched.)

- [ ] **Step 2: `WeeklyScheduleTemplatePickerDialog.tsx` (self-triggered → controlled trigger)**

Imports at lines 5–12 → `import { ResponsiveModal } from "@/components/ResponsiveModal";`. This dialog owns its `open` state (line ~155 `useState`) and renders a `<DialogTrigger asChild>` (lines 188–206). Convert: render the trigger button directly with `onClick={() => setOpen(true)}`, then the modal:

```tsx
    <>
      {/* the existing trigger button (current lines 189–205), with onClick={() => setOpen(true)} added
          and the <DialogTrigger asChild> wrapper removed */}
      <ResponsiveModal
        open={open}
        onOpenChange={(next) => {
          /* the existing onOpenChange body from lines 183–187, verbatim */
        }}
        size="md"
        title={<span className="text-base">Schedule templates</span>}
        description={/* existing <DialogDescription> children, lines 214–216, verbatim */}
        headerClassName="shrink-0 space-y-1.5 border-b border-border/60 px-5 py-4 text-left"
      >
        {/* body from lines 218–255 (the ScrollArea + list), verbatim */}
      </ResponsiveModal>
    </>
```

Replace `</DialogContent></Dialog>` (lines 256–257) with `</ResponsiveModal>` and close the fragment.

- [ ] **Step 3: `WeeklySchedulePage.tsx` inline confirm (controlled)**

Find the confirm import of Dialog primitives at the top of the file and remove the now-unused ones (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`) if they are used nowhere else in the file; add `import { ResponsiveModal } from "@/components/ResponsiveModal";`. Replace the confirm block at lines 597–608 (`<Dialog open={confirmOpen} onOpenChange={…}>` + `<DialogContent className="max-h-[85vh] overflow-y-auto">` + `<DialogHeader>`) with:

```tsx
      <ResponsiveModal
        open={confirmOpen}
        onOpenChange={(o) => {
          if (applying) return; // don't let an outside-click/Escape dismiss mid-save
          setConfirmOpen(o);
          if (!o) {
            setConfirmText("");
            if (status?.type === "error") clearStatus();
          }
        }}
        size="md"
        title={
          <span className="break-words">
            {isEditing
              ? `Change ${employeeLabel ?? "this employee"}'s schedule?`
              : "Create shared shift records?"}
          </span>
        }
        description={
          isEditing
            ? "Review what changes and confirm to apply."
            : "Confirm to create shared Shift Type and Shift Schedule records on save."
        }
        bodyClassName="px-6 py-2"
        footer={/* the existing <DialogFooter> children (Cancel + confirm buttons, lines 688–…), verbatim */}
      >
        {/* the confirm body: the pendingConfirmPlan <ul>, the summarizeReconcile block,
            the type-to-confirm Input, and the error <p> — current lines 621–687, verbatim */}
      </ResponsiveModal>
```

Remove the old `<DialogHeader>…</DialogHeader>` (its title/description move to the props) and the old `<DialogFooter>…</DialogFooter>` / `</DialogContent></Dialog>` closers.

- [ ] **Step 4: Write the migration regression guard**

Create `src/ui/dialogMigration.test.tsx`:

```tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MIGRATED = [
  "src/ui/RunEngineDialog.tsx",
  "src/ui/ClearAllSchedulesDialog.tsx",
  "src/ui/ClearEmployeeScheduleDialog.tsx",
  "src/ui/ClearSitePatternsDialog.tsx",
  "src/ui/SchedulePlanPreviewDialog.tsx",
  "src/ui/WeeklyScheduleTemplatePickerDialog.tsx",
  "src/ui/WeeklySchedulePage.tsx",
];

test("every quick-decision surface routes through ResponsiveModal (adaptive on mobile)", () => {
  for (const rel of MIGRATED) {
    const src = readFileSync(resolve(PKG, rel), "utf8");
    assert.match(src, /ResponsiveModal/, `${rel} uses ResponsiveModal`);
    assert.ok(
      !/from "@\/components\/ui\/dialog"/.test(src),
      `${rel} no longer imports the raw Dialog primitive`,
    );
  }
});
```

- [ ] **Step 5: Run the guard + full suite + typecheck**

Run: `npx tsc --noEmit && npm run test:web`
Expected: no TS errors; `dialogMigration` passes; all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/ui/SchedulePlanPreviewDialog.tsx src/ui/WeeklyScheduleTemplatePickerDialog.tsx src/ui/WeeklySchedulePage.tsx src/ui/dialogMigration.test.tsx
git commit -m "refactor(hr-attendance): migrate remaining dialogs to ResponsiveModal + guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Shared timeline-window module + hook

**Files:**
- Create: `src/lib/weekTimelineWindow.ts`, `src/hooks/useWeekTimelineWindow.ts`
- Test: `src/lib/weekTimelineWindow.test.ts`
- Modify: `src/ui/WeekView.tsx` (consume the hook; desktop output identical)

**Interfaces:**
- Consumes: `computeWeekTimelineWindow`, `weekTimelineCanvasHeightPct` from `@/lib/attendancePunches`; `minutesFromDateTime`, `parseTimeToMinutes` from `@/lib/attendanceTime`; `Day` from `@/types/calendar`; `format` from `date-fns`.
- Produces:
  ```ts
  // src/lib/weekTimelineWindow.ts
  export function collectWeekTimelineMinutes(weekDates: Date[], daysByDate: Map<string, Day>): number[];
  export type WeekTimelineWindow = { startMin: number; endMin: number; spanMinutes: number; canvasHeightPct: number };
  export function resolveWeekTimelineWindow(weekDates: Date[], daysByDate: Map<string, Day>): WeekTimelineWindow;
  // src/hooks/useWeekTimelineWindow.ts
  export function useWeekTimelineWindow(weekDates: Date[], daysByDate: Map<string, Day>): WeekTimelineWindow;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/weekTimelineWindow.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectWeekTimelineMinutes, resolveWeekTimelineWindow } from "./weekTimelineWindow";
import type { Day } from "../types/calendar";

const D = (iso: string) => new Date(`${iso}T00:00:00`);

test("collectWeekTimelineMinutes gathers checkin, first/last, and shift minutes", () => {
  const days = new Map<string, Day>([
    [
      "2026-07-14",
      {
        date: "2026-07-14",
        checkins: [{ time: "2026-07-14 09:15:00" }],
        first_in: "2026-07-14 09:00:00",
        last_out: "2026-07-14 17:30:00",
        shift: { shift_assigned: true, start_time: "08:30:00", end_time: "17:00:00" },
      } as unknown as Day,
    ],
  ]);
  const mins = collectWeekTimelineMinutes([D("2026-07-14")], days);
  assert.ok(mins.includes(9 * 60 + 15), "includes checkin 09:15");
  assert.ok(mins.includes(8 * 60 + 30), "includes shift start 08:30");
  assert.ok(mins.includes(17 * 60), "includes shift end 17:00");
});

test("resolveWeekTimelineWindow falls back to 08:00–18:00 with no data and reports canvas height", () => {
  const w = resolveWeekTimelineWindow([D("2026-07-14")], new Map());
  assert.equal(w.startMin, 8 * 60);
  assert.equal(w.endMin, 18 * 60);
  assert.equal(w.spanMinutes, 10 * 60);
  assert.equal(w.canvasHeightPct, 100, "10h span == exactly one viewport");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/weekTimelineWindow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure module**

Create `src/lib/weekTimelineWindow.ts` (the minute-collection logic is lifted verbatim from `WeekView.tsx:78-108`):

```ts
import { format } from "date-fns";

import { computeWeekTimelineWindow, weekTimelineCanvasHeightPct } from "@/lib/attendancePunches";
import { minutesFromDateTime, parseTimeToMinutes } from "@/lib/attendanceTime";
import type { Day } from "@/types/calendar";

export type WeekTimelineWindow = {
  startMin: number;
  endMin: number;
  spanMinutes: number;
  canvasHeightPct: number;
};

/** Every minute-of-day that should influence the shared vertical axis across the week. */
export function collectWeekTimelineMinutes(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): number[] {
  const mins: number[] = [];
  for (const d of weekDates) {
    const key = format(d, "yyyy-MM-dd");
    const info = daysByDate.get(key);
    for (const c of info?.checkins ?? []) {
      const m = minutesFromDateTime(c.time);
      if (m != null) mins.push(m);
    }
    if (info?.first_in) {
      const m = minutesFromDateTime(info.first_in);
      if (m != null) mins.push(m);
    }
    if (info?.last_out) {
      const m = minutesFromDateTime(info.last_out);
      if (m != null) mins.push(m);
    }
    const shift = info?.shift;
    if (shift?.shift_assigned) {
      const start = parseTimeToMinutes(shift.start_time ?? null);
      const end = parseTimeToMinutes(shift.end_time ?? null);
      if (start != null) mins.push(start);
      if (end != null) mins.push(end);
      const lunchStart = parseTimeToMinutes(shift.lunch_start ?? null);
      const lunchEnd = parseTimeToMinutes(shift.lunch_end ?? null);
      if (lunchStart != null) mins.push(lunchStart);
      if (lunchEnd != null) mins.push(lunchEnd);
    }
  }
  return mins;
}

/** The shared axis window + inner canvas height, used by both the week grid and the phone day view. */
export function resolveWeekTimelineWindow(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): WeekTimelineWindow {
  const window = computeWeekTimelineWindow(collectWeekTimelineMinutes(weekDates, daysByDate));
  return { ...window, canvasHeightPct: weekTimelineCanvasHeightPct(window.spanMinutes) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/weekTimelineWindow.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the hook**

Create `src/hooks/useWeekTimelineWindow.ts`:

```ts
import { useMemo } from "react";

import { resolveWeekTimelineWindow, type WeekTimelineWindow } from "@/lib/weekTimelineWindow";
import type { Day } from "@/types/calendar";

export function useWeekTimelineWindow(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): WeekTimelineWindow {
  return useMemo(() => resolveWeekTimelineWindow(weekDates, daysByDate), [weekDates, daysByDate]);
}
```

- [ ] **Step 6: Refactor `WeekView.tsx` to consume the hook (desktop-safe)**

In `src/ui/WeekView.tsx`:
- Add import: `import { useWeekTimelineWindow } from "@/hooks/useWeekTimelineWindow";`
- Delete the inline `weekWindow` `useMemo` (lines 78–108) and the `canvasHeightPct` line (110). Remove the now-unused imports (`minutesFromDateTime`, `parseTimeToMinutes`, `computeWeekTimelineWindow`, `weekTimelineCanvasHeightPct`) if they are used nowhere else in the file; keep `format`, `useEffect`, `useRef`.
- Replace with (note the argument order is `(weekDates, daysByDate)`):

```tsx
  const weekWindow = useWeekTimelineWindow(props.weekDates, props.daysByDate);
  const canvasHeightPct = weekWindow.canvasHeightPct;
```
- The `useEffect` that resets `scrollTop` on `[weekWindow.startMin, weekWindow.endMin]` (lines 112–116) stays unchanged. Everything else in the file is unchanged.

- [ ] **Step 7: Verify desktop output is unchanged**

Run: `npx tsc --noEmit && npm run test:web`
Expected: no TS errors; all tests pass. Then (recommended) `npm run dev:hr` at desktop width: the week grid axis and scroll behavior are visually identical to before.

- [ ] **Step 8: Commit**

```bash
git add src/lib/weekTimelineWindow.ts src/lib/weekTimelineWindow.test.ts src/hooks/useWeekTimelineWindow.ts src/ui/WeekView.tsx
git commit -m "refactor(hr-attendance): extract shared week timeline-window hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract `DayChips`

**Files:**
- Create: `src/ui/DayChips.tsx`
- Modify: `src/ui/WeekView.tsx` (consume `DayChips` in the header cell; desktop output identical)

**Interfaces:**
- Consumes: `AppTooltip`; `Day`, `DeviceAlert`, `Flag` from `@/types/calendar`.
- Produces:
  ```ts
  export type DayChipsProps = {
    day?: Day;
    alerts?: DeviceAlert[];
    onInspectFlag?: (flag: Flag) => void;
  };
  export function DayChips(props: DayChipsProps): JSX.Element | null;  // null when no chips
  ```

- [ ] **Step 1: Create `DayChips.tsx`**

Lift the chip block from `WeekView.tsx:187-218` (the `flex flex-wrap` group: Leave chip, OFF_SHIFT button, device-alert `!` badge) plus the `dayOffShiftPunchFlag` helper (`WeekView.tsx:62-64`):

```tsx
import type { Day, DeviceAlert, Flag } from "@/types/calendar";

import { AppTooltip } from "@/ui/AppTooltip";

export type DayChipsProps = {
  day?: Day;
  alerts?: DeviceAlert[];
  onInspectFlag?: (flag: Flag) => void;
};

function offShiftPunchFlag(day?: Day): Flag | undefined {
  return (day?.flags ?? []).find((flag) => flag.flag_code === "OFF_SHIFT_PUNCH");
}

// Leave / off-shift / device-alert chips for one day. Shared by the desktop week
// grid header and the phone day-view header so the chip set cannot drift.
export function DayChips(props: DayChipsProps) {
  const onLeave = props.day?.leave?.on_leave;
  const offShiftFlag = offShiftPunchFlag(props.day);
  const hasAlert = (props.alerts ?? []).length > 0;

  if (!onLeave && !offShiftFlag && !hasAlert) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {onLeave ? (
        <AppTooltip
          content={props.day?.leave?.leave_type ? `On leave · ${props.day.leave.leave_type}` : "On leave"}
          side="bottom"
        >
          <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
            Leave
          </span>
        </AppTooltip>
      ) : null}
      {offShiftFlag ? (
        <AppTooltip content="Review off-shift punch flag" side="bottom">
          <button
            type="button"
            onClick={() => props.onInspectFlag?.(offShiftFlag)}
            className="inline-flex max-w-full items-center rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive hover:bg-destructive/15"
          >
            OFF_SHIFT
          </button>
        </AppTooltip>
      ) : null}
      {hasAlert ? (
        <AppTooltip content="Device closeout pending" side="bottom">
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-brand-accent/40 bg-brand-accent/10 px-1 text-[10px] font-semibold text-brand-accent">
            !
          </span>
        </AppTooltip>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Consume it in `WeekView.tsx`**

In `src/ui/WeekView.tsx`:
- Add `import { DayChips } from "@/ui/DayChips";`.
- The header cell currently computes `offShiftFlag` (line 130) and renders the chip block (lines 187–218). Keep the `WeekDayDateBadge`'s `hasOffShiftPunch={offShiftFlag != null}` need: compute `const offShiftFlag = dayOffShiftPunchFlag(info);` still (the local helper stays for the badge). Replace the chip `<div className="mt-1 flex flex-wrap …">…</div>` (lines 187–218) with:

```tsx
              <div className="mt-1">
                <DayChips
                  day={info}
                  alerts={props.alertsByDate.get(key) ?? []}
                  onInspectFlag={(flag) => props.onInspectFlag(key, flag)}
                />
              </div>
```

Leave `WeekDayDateBadge` and `dayOffShiftPunchFlag` in `WeekView.tsx` as-is (the badge still uses the flag). Desktop rendering is unchanged (same markup, same tooltips).

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run test:web`
Expected: no TS errors; all tests pass.

```bash
git add src/ui/DayChips.tsx src/ui/WeekView.tsx
git commit -m "refactor(hr-attendance): extract DayChips shared by week grid + phone day view

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `weekDayView` pure helpers (TDD)

**Files:**
- Create: `src/lib/weekDayView.ts`
- Test: `src/lib/weekDayView.test.ts`

**Interfaces:**
- Consumes: `format`, `isSameDay` from `date-fns`; `Day` from `@/types/calendar`.
- Produces:
  ```ts
  export function initialSelectedDate(weekDates: Date[], today: Date): string;               // yyyy-MM-dd
  export function stepDay(weekDates: Date[], currentKey: string, dir: -1 | 1): string;        // clamped, no wrap
  export type PipState = "today" | "holiday" | "off" | "flagged" | "normal";
  export function dayPipState(day: Day | undefined, isToday: boolean): PipState;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/weekDayView.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSelectedDate, stepDay, dayPipState } from "./weekDayView";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`)); // Mon 13 … Sun 19

test("initialSelectedDate picks today when in the week, else the first day", () => {
  assert.equal(initialSelectedDate(WEEK, new Date("2026-07-16T09:00:00")), "2026-07-16");
  assert.equal(initialSelectedDate(WEEK, new Date("2026-08-01T09:00:00")), "2026-07-13");
});

test("stepDay clamps at both ends (no wrap)", () => {
  assert.equal(stepDay(WEEK, "2026-07-16", 1), "2026-07-17");
  assert.equal(stepDay(WEEK, "2026-07-16", -1), "2026-07-15");
  assert.equal(stepDay(WEEK, "2026-07-19", 1), "2026-07-19", "clamped at last day");
  assert.equal(stepDay(WEEK, "2026-07-13", -1), "2026-07-13", "clamped at first day");
});

test("dayPipState precedence: today > holiday > off > flagged > normal", () => {
  assert.equal(dayPipState({ holiday: { description: "x" } } as unknown as Day, true), "today");
  assert.equal(dayPipState({ holiday: { description: "x" } } as unknown as Day, false), "holiday");
  assert.equal(dayPipState({ shift: { shift_assigned: false } } as unknown as Day, false), "off");
  assert.equal(
    dayPipState({ shift: { shift_assigned: true }, flags: [{ flag_code: "LATE_START" }] } as unknown as Day, false),
    "flagged",
  );
  assert.equal(dayPipState({ shift: { shift_assigned: true }, flags: [] } as unknown as Day, false), "normal");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/weekDayView.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/weekDayView.ts`:

```ts
import { format, isSameDay } from "date-fns";

import type { Day } from "@/types/calendar";

export type PipState = "today" | "holiday" | "off" | "flagged" | "normal";

const key = (d: Date) => format(d, "yyyy-MM-dd");

export function initialSelectedDate(weekDates: Date[], today: Date): string {
  const inWeek = weekDates.find((d) => isSameDay(d, today));
  return key(inWeek ?? weekDates[0]!);
}

export function stepDay(weekDates: Date[], currentKey: string, dir: -1 | 1): string {
  const idx = weekDates.findIndex((d) => key(d) === currentKey);
  if (idx === -1) return currentKey;
  const next = Math.min(weekDates.length - 1, Math.max(0, idx + dir));
  return key(weekDates[next]!);
}

// Matches the desktop grid's off-day rule (holiday wins; no assigned shift == off).
export function dayPipState(day: Day | undefined, isToday: boolean): PipState {
  if (isToday) return "today";
  if (day?.holiday != null) return "holiday";
  if (day?.shift?.shift_assigned !== true) return "off";
  if ((day?.flags ?? []).length > 0) return "flagged";
  return "normal";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/weekDayView.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/weekDayView.ts src/lib/weekDayView.test.ts
git commit -m "feat(hr-attendance): weekDayView pure helpers (initial/step/pip state)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `WeekDayView` component

**Files:**
- Create: `src/ui/WeekDayView.tsx`
- Test: `src/ui/WeekDayView.test.tsx`

**Interfaces:**
- Consumes: `useWeekTimelineWindow` (Task 5), `DayChips` (Task 6), `weekDayView` helpers (Task 7), `DayCell` from `@/ui/DayTimeline` (props: `{ date, outside, today, info?, dense, timelineStartMin?, timelineEndMin?, deviceSync?, onInspectDay }`), `AppTooltip`, `Button`.
- Produces:
  ```ts
  export type WeekDayViewProps = {
    weekDates: Date[];
    daysByDate: Map<string, Day>;
    alertsByDate: Map<string, DeviceAlert[]>;
    syncByDate: Map<string, DeviceSyncStatus[]>;
    onInspectDay: (date: string) => void;
    onInspectFlag: (date: string, flag: Flag) => void;
  };
  export function WeekDayView(props: WeekDayViewProps): JSX.Element;
  ```
  (Identical prop shape to `WeekViewProps`, so `App.tsx` can pass the same object to either.)

- [ ] **Step 1: Write the failing test**

Create `src/ui/WeekDayView.test.tsx`:

```tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekDayView } from "./WeekDayView";
import type { Day } from "../types/calendar";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

test("WeekDayView renders a 7-pip day switcher and one selected day", () => {
  const html = renderToStaticMarkup(
    <WeekDayView
      weekDates={WEEK}
      daysByDate={new Map<string, Day>()}
      alertsByDate={new Map()}
      syncByDate={new Map()}
      onInspectDay={() => {}}
      onInspectFlag={() => {}}
    />,
  );
  const pips = html.match(/data-pip=/g) ?? [];
  assert.equal(pips.length, 7, "one pip per weekday");
  assert.match(html, /aria-label="Previous day"/);
  assert.match(html, /aria-label="Next day"/);
});

test("WeekDayView reuses the shared timeline window + DayChips (no drift)", () => {
  const src = readFileSync(resolve(PKG, "src/ui/WeekDayView.tsx"), "utf8");
  assert.match(src, /useWeekTimelineWindow/, "shares the axis window with the desktop grid");
  assert.match(src, /DayCell/, "renders the standalone DayCell");
  assert.match(src, /DayChips/, "reuses the shared chip row");
  assert.match(src, /stepDay/, "chevrons step through the week");
  assert.ok(!/overflow-x-auto/.test(src), "never horizontally scrolls");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/ui/WeekDayView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `WeekDayView.tsx`**

```tsx
import type { Day, DeviceAlert, DeviceSyncStatus, Flag } from "@/types/calendar";
import { format, isSameDay } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { initialSelectedDate, stepDay, dayPipState, type PipState } from "@/lib/weekDayView";
import { useWeekTimelineWindow } from "@/hooks/useWeekTimelineWindow";
import { DayCell } from "@/ui/DayTimeline";
import { DayChips } from "@/ui/DayChips";

const PIP_TONE: Record<PipState, string> = {
  today: "bg-primary text-primary-foreground",
  holiday: "bg-muted text-brand-accent",
  off: "bg-destructive/10 text-destructive",
  flagged: "bg-destructive/15 text-destructive ring-1 ring-destructive/40",
  normal: "bg-muted/50 text-muted-foreground",
};

export type WeekDayViewProps = {
  weekDates: Date[];
  daysByDate: Map<string, Day>;
  alertsByDate: Map<string, DeviceAlert[]>;
  syncByDate: Map<string, DeviceSyncStatus[]>;
  onInspectDay: (date: string) => void;
  onInspectFlag: (date: string, flag: Flag) => void;
};

export function WeekDayView(props: WeekDayViewProps) {
  const weekWindow = useWeekTimelineWindow(props.weekDates, props.daysByDate);
  const [selectedKey, setSelectedKey] = useState(() =>
    initialSelectedDate(props.weekDates, new Date()),
  );

  // New week (prev/next/jump) → reseed to today-or-first.
  const weekKey = format(props.weekDates[0]!, "yyyy-MM-dd");
  useEffect(() => {
    setSelectedKey(initialSelectedDate(props.weekDates, new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);

  const selectedDate =
    props.weekDates.find((d) => format(d, "yyyy-MM-dd") === selectedKey) ?? props.weekDates[0]!;
  const selectedInfo = props.daysByDate.get(selectedKey);
  const atFirst = selectedKey === format(props.weekDates[0]!, "yyyy-MM-dd");
  const atLast = selectedKey === format(props.weekDates[6]!, "yyyy-MM-dd");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
      {/* Day switcher */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          disabled={atFirst}
          onClick={() => setSelectedKey((k) => stepDay(props.weekDates, k, -1))}
          aria-label="Previous day"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>

        <div className="min-w-0 flex-1 text-center text-sm font-semibold tracking-tight">
          {format(selectedDate, "EEE d")}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          disabled={atLast}
          onClick={() => setSelectedKey((k) => stepDay(props.weekDates, k, 1))}
          aria-label="Next day"
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      {/* Pip strip */}
      <div className="flex shrink-0 items-center justify-between gap-1 px-3 py-2">
        {props.weekDates.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const isToday = isSameDay(d, new Date());
          const state = dayPipState(props.daysByDate.get(key), isToday);
          const active = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              data-pip={state}
              onClick={() => setSelectedKey(key)}
              aria-label={format(d, "EEEE d")}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex h-9 flex-1 flex-col items-center justify-center rounded-lg text-[10px] font-semibold tabular-nums transition-colors",
                PIP_TONE[state],
                active && "ring-2 ring-primary ring-offset-1 ring-offset-background",
              )}
            >
              <span className="opacity-70">{format(d, "EEEEE")}</span>
              <span>{format(d, "d")}</span>
            </button>
          );
        })}
      </div>

      {/* Selected-day chips */}
      <div className="shrink-0 px-3">
        <DayChips
          day={selectedInfo}
          alerts={props.alertsByDate.get(selectedKey) ?? []}
          onInspectFlag={(flag) => props.onInspectFlag(selectedKey, flag)}
        />
      </div>

      {/* One full-width day timeline, shared axis */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div style={{ height: `${weekWindow.canvasHeightPct}%` }}>
          <DayCell
            date={selectedDate}
            outside={false}
            today={isSameDay(selectedDate, new Date())}
            info={selectedInfo}
            dense={false}
            timelineStartMin={weekWindow.startMin}
            timelineEndMin={weekWindow.endMin}
            deviceSync={props.syncByDate.get(selectedKey) ?? []}
            onInspectDay={() => props.onInspectDay(selectedKey)}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/ui/WeekDayView.test.tsx`
Expected: PASS (2 tests). If `Button` `size="icon-sm"` is not a valid variant, use `size="icon"` (check `src/components/ui/button.tsx` — `DayInspectorSheet.tsx` uses `size="icon-sm"`, so it exists).

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npm run test:web`
Expected: no TS errors; all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/WeekDayView.tsx src/ui/WeekDayView.test.tsx
git commit -m "feat(hr-attendance): phone single-day WeekDayView with day switcher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Fork the week screen on mobile + responsive skeleton

**Files:**
- Modify: `src/ui/App.tsx`, `src/ui/AttendanceLoading.tsx`

**Interfaces:**
- Consumes: `WeekDayView` (Task 8), `useIsMobile`, `Skeleton`.
- Produces: nothing new.

- [ ] **Step 1: Fork `App.tsx`**

In `src/ui/App.tsx`:
- Add imports: `import { useIsMobile } from "@/hooks/useIsMobile";` and `import { WeekDayView } from "@/ui/WeekDayView";`.
- Inside `App()`, add near the other hooks (e.g. after line 46): `const isMobile = useIsMobile();`.
- Hoist the two inspect handlers above the return so both views share them. Just before `return (` (line 251), add:

```tsx
  const handleInspectDay = (date: string) => {
    setInspectingDate(date);
    setReviewingFlag(null);
  };
  const handleInspectFlag = (date: string, flag: Flag) => {
    setInspectingDate(date);
    setReviewingFlag(flag);
  };
```

- Replace the final `) : ( <WeekView … /> )` branch of the render ternary (lines 348–363 — the `) : (` at 348, the `<WeekView>` element, and its closing `)` at 363) with the two-way `isMobile` chain below. This turns `… : (WeekView)` into `… : isMobile ? (WeekDayView) : (WeekView)`:

```tsx
                  ) : isMobile ? (
                    <WeekDayView
                      weekDates={weekDates}
                      daysByDate={daysByDate}
                      alertsByDate={alertsByDate}
                      syncByDate={syncByDate}
                      onInspectDay={handleInspectDay}
                      onInspectFlag={handleInspectFlag}
                    />
                  ) : (
                    <WeekView
                      weekDates={weekDates}
                      daysByDate={daysByDate}
                      alertsByDate={alertsByDate}
                      syncByDate={syncByDate}
                      onInspectDay={handleInspectDay}
                      onInspectFlag={handleInspectFlag}
                    />
                  )}
```

(The preceding `selectedEmployee?.has_shift_assignment === false ? (…No schedule…) :` branch at line 338 now chains into `isMobile ? … : …`.)

- [ ] **Step 2: Make `WeekViewSkeleton` responsive so the loading state doesn't h-scroll on phones**

In `src/ui/AttendanceLoading.tsx`, replace `WeekViewSkeleton` (lines 40–72) with a version that renders a mobile single-day skeleton below `md` and the existing 7-col grid at `md+`:

```tsx
export function WeekViewSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card animate-in fade-in">
      {/* Mobile: day switcher + pip strip + one tall timeline (matches WeekDayView) */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <Skeleton className="h-4 min-w-0 flex-1 rounded" />
          <Skeleton className="size-8 shrink-0 rounded-md" />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-1 px-3 py-2">
          {Array.from({ length: 7 }).map((_, idx) => (
            <Skeleton key={idx} className="h-9 flex-1 rounded-lg" />
          ))}
        </div>
        <div className="min-h-0 flex-1 p-3">
          <Skeleton className="h-full min-h-[320px] w-full rounded-xl" />
        </div>
      </div>

      {/* Desktop: the 7-column grid */}
      <div className="hidden min-h-0 flex-1 flex-col overflow-x-auto md:flex">
        <div className="grid shrink-0 grid-cols-[repeat(7,minmax(8rem,1fr))] border-b border-border/60">
          {Array.from({ length: 7 }).map((_, idx) => (
            <div key={idx} className="space-y-2 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-8" />
                  <Skeleton className="size-6 rounded-full" />
                </div>
                <Skeleton className="h-3 w-8" />
              </div>
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-4 w-10 rounded-full" />
            </div>
          ))}
        </div>
        <div className="grid min-h-[420px] flex-1 grid-cols-[repeat(7,minmax(8rem,1fr))] gap-px bg-border/40 p-px">
          {Array.from({ length: 7 }).map((_, idx) => (
            <div key={idx} className="flex flex-col gap-2 bg-card p-2">
              <Skeleton className="h-[18%] w-full rounded-sm" />
              <Skeleton className="h-[28%] w-full rounded-sm" />
              <Skeleton className="h-[12%] w-[80%] rounded-sm" />
              <Skeleton className="h-[22%] w-full rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

All call sites (`App.tsx:313`, `WeekViewAnimatedShell`, `AttendancePageSkeleton`) are unchanged.

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit && npm run test:web`
Expected: no TS errors; all pass (the existing `responsiveShell` tests still pass).

- [ ] **Step 4: Manual sanity**

`npm run dev:hr`: at `< 768px` the week is a single-day view with a working pip strip / chevrons and no horizontal scroll; the loading skeleton is the single-day variant. At `≥ 768px` the 7-column grid and its skeleton are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx src/ui/AttendanceLoading.tsx
git commit -m "feat(hr-attendance): render WeekDayView on phones; responsive week skeleton

Fixes P3-a — the primary attendance screen no longer h-scrolls on a phone.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Dock detail sheets from the bottom on mobile (P4-b)

**Files:**
- Modify: `src/ui/DayInspectorSheet.tsx`, `src/ui/WeeklyScheduleSheet.tsx`

**Interfaces:**
- Consumes: `useIsMobile`.
- Produces: nothing new.

- [ ] **Step 1: `DayInspectorSheet.tsx`**

- Add `import { useIsMobile } from "@/hooks/useIsMobile";`.
- Inside the component, add `const isMobile = useIsMobile();`.
- Replace the `SheetContent` open tag (line 98–99) `<SheetContent side="right" className="flex w-[440px] flex-col overflow-hidden sm:max-w-md">` with:

```tsx
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "flex flex-col overflow-hidden",
          isMobile
            ? "max-h-[min(90dvh,44rem)] rounded-t-2xl"
            : "w-full sm:w-[440px] sm:max-w-md",
        )}
      >
```

(`cn` is already imported in this file.) This also normalizes the dead `w-[440px]` (P3-d cleanup).

- [ ] **Step 2: `WeeklyScheduleSheet.tsx`**

- Add `import { useIsMobile } from "@/hooks/useIsMobile";` and `import { cn } from "@/lib/utils";`.
- Inside the component, add `const isMobile = useIsMobile();`.
- Replace the `SheetContent` open tag (lines 65–68) with:

```tsx
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          isMobile ? "max-h-[min(90dvh,44rem)] rounded-t-2xl" : "w-full sm:max-w-md",
        )}
      >
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit && npm run test:web`
Expected: no TS errors; all pass.

- [ ] **Step 4: Manual sanity**

`npm run dev:hr` at `< 768px`: tapping a day opens the inspector as a bottom sheet with a rounded top that clears the home indicator and internal tabs scroll within the sheet; the weekly-schedule sheet docks bottom too. At `≥ 768px` both slide in from the right as before.

- [ ] **Step 5: Commit**

```bash
git add src/ui/DayInspectorSheet.tsx src/ui/WeeklyScheduleSheet.tsx
git commit -m "feat(hr-attendance): detail sheets dock to the bottom on mobile (P4-b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Phone-viewport e2e walk

**Files:**
- Create: `e2e/mobile-surfaces.spec.ts`

**Interfaces:**
- Consumes: the running app (Playwright config already serves it). Follow the existing `e2e/audit-walk.spec.ts` / `e2e/attendance.spec.ts` patterns for fixtures, base URL, and API mocking.

- [ ] **Step 1: Inspect the existing e2e setup**

Read `e2e/audit-walk.spec.ts`, `e2e/attendance.spec.ts`, `e2e/fixtures.ts`, and `playwright.config.ts` to reuse their route mocking and navigation helpers (the assertions below assume the same `page.goto('/hr-attendance')` + mocked calendar payload those specs use).

- [ ] **Step 2: Write the spec**

Create `e2e/mobile-surfaces.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
// Reuse the same mocking/setup helpers the existing specs use.
// import { mockCalendar, gotoAttendance } from "./fixtures";

const PHONE = { width: 390, height: 844 };

test.describe("mobile surfaces", () => {
  test.use({ viewport: PHONE });

  test("the week screen never scrolls horizontally on a phone", async ({ page }) => {
    // await mockCalendar(page);
    // await gotoAttendance(page);
    await page.goto("/hr-attendance");
    await page.waitForLoadState("networkidle");
    const overflowing = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowing, "no horizontal overflow at 390px").toBe(false);
    await expect(page.getByLabel("Next day")).toBeVisible();
  });

  test("a quick-decision dialog opens as a bottom sheet on a phone", async ({ page }) => {
    // Navigate to a surface that opens one of the migrated dialogs (e.g. the schedule
    // template picker or run-engine trigger), open it, then assert the bottom sheet.
    await page.goto("/hr-attendance");
    await page.waitForLoadState("networkidle");
    // …trigger a migrated ResponsiveModal…
    const sheet = page.locator('[data-slot="sheet-content"][data-side="bottom"]');
    await expect(sheet).toBeVisible();
  });
});
```

Fill in the commented lines using the project's real fixtures/helpers discovered in Step 1 (mock the calendar API, drive whichever migrated modal is reachable from the attendance/schedule routes). If a modal is not reachable without deep setup, keep the horizontal-overflow test (the P3-a proof) as the required assertion and mark the bottom-sheet test `test.fixme` with a note, rather than shipping a flaky selector.

- [ ] **Step 3: Run e2e**

Run: `npm run test:e2e -- mobile-surfaces`
Expected: the horizontal-overflow test passes; the bottom-sheet test passes (or is an explicit `fixme`).

- [ ] **Step 4: Run the full unit suite once more**

Run: `npm run test:web`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add e2e/mobile-surfaces.spec.ts
git commit -m "test(hr-attendance): phone-viewport e2e — no h-scroll + bottom-sheet dialogs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done criteria

- `npm run test:web` and `npx tsc --noEmit` are green; `npm run test:e2e -- mobile-surfaces` passes (or the bottom-sheet leg is an explicit `fixme`).
- At `< 768px`: the week screen is a single-day view with a day switcher and **no horizontal scroll**; the seven quick-decision dialogs open as bottom sheets; the day-inspector and weekly-schedule sheets dock from the bottom.
- At `≥ 768px`: the 7-column week grid, all dialogs (centered), and the right-side sheets render exactly as before.
- `git log` shows one focused commit per task on `feat/hr-attendance-mobile-surfaces`.

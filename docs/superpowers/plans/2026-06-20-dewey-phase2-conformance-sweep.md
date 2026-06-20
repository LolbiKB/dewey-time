# Dewey Phase 2 — Conformance Sweep Plan

> **For agentic workers:** executed via superpowers:subagent-driven-development, cluster-by-cluster. Each cluster = one implementer + one review + a commit.

**Goal:** Bring the 27 SPA screens onto the Dewey signal system — replace the pre-Dewey `emerald`/`sky`/`amber` palette + tinted surfaces + `dark:` variants with brand tokens, applied by meaning.

**Why this is autonomous & green-independent:** the mapping targets TOKENS (`--primary`, `--brand-accent`, `--destructive`, neutrals), not fixed hues — so it tracks whatever green is finalized (one knob) and is reversible per commit. Deploy is explicitly OUT of scope.

## Global Constraints

- Add NO new dependencies; tests run in the existing `node:test`+`tsx` harness.
- **Surfaces stay NEUTRAL.** Never tint a panel background with a brand/semantic hue. The signal rides text / icon / a thin left-bar / a border-accent — not a filled colored background. (Genuinely urgent banners may use `bg-brand-accent/5 border-brand-accent/30` *sparingly*.)
- Light-only: remove every `dark:` variant encountered.
- One knob: no hardcoded hues; use tokens. The orange utility is `text-brand-accent`/`bg-brand-accent` (added in `8cc8bb22`).
- Don't restructure logic or layout — this is a color/motion conformance pass only. Keep diffs surgical.
- Commit trailer required. Work on `main`, local commits, no push. Stage ONLY the cluster's files (working tree has unrelated node_modules noise).
- Bundle (`public/hr_attendance/**`) is rebuilt+committed ONCE at the end, not per cluster.

## Mapping reference (apply by MEANING, not mechanically)

| Off-brand usage | Dewey replacement | Meaning |
|---|---|---|
| `text-emerald-*` (success/confirm text/icon) | `text-primary` | proceed / approve / positive |
| `bg-emerald-500/5` `border-emerald-500/25` success panel | neutral surface (`bg-muted/40` or plain `border` card) + `text-primary` heading/icon (or a `bg-primary` left-bar) | detint; signal via accent |
| `text-amber-*` (warning/caution text) | `text-brand-accent` | urgent / attention |
| `bg-amber-500/5` `border-amber-500/*` warning strip | neutral surface + `text-brand-accent` icon; OR `bg-brand-accent/5 border-brand-accent/30` only if a true urgent banner | warning |
| `text-sky-*` / `bg-sky-500/5` / `border-sky-500/30` (info/active) | neutral: `text-foreground`/`text-muted-foreground`, `bg-muted/40`, `border`. If it marks a **current/active/selected** affordance → `text-primary` / `ring-primary` / `bg-primary` bar | info → neutral; active → primary |
| `bg-emerald-600`/`bg-sky-500` solid left-bars | `bg-primary` (if active/positive) or `bg-muted-foreground`/`bg-border` (if neutral marker) | by meaning |
| destructive (delete/clear/discard) not red | `text-destructive` / `bg-destructive` / `variant="destructive"` | irreversible |
| `dark:*` anything | remove | light-only |
| ad-hoc `duration-200/300/350`, `ease-out` | drop (rely on base.css / dewey-ui defaults); keep `animate-spin` | motion restraint |

Judgment notes: a "X will be cleared" panel inside a *destructive* dialog is informational → **neutral** surface (the destructive signal belongs on the confirm button, not the panel). A confirmation of a *safe/positive* action → `text-primary`. When unsure whether a color is a signal, make it neutral ("if it isn't a signal, it's gray").

## Clusters (each is one task: implementer → review → commit)

- **A — Main calendar** (highest visibility): `WeekView.tsx`, `DayTimeline.tsx`, `FlagDetailPanel.tsx`, `WeekFlagSummary.tsx`, `App.tsx`.
- **B — Day inspector**: `DayInspectorSheet.tsx` (heavy `sky`).
- **C — Schedule wizard**: `WeeklySchedulePage.tsx`, `WeekScheduleGantt.tsx`, `WeekPatternGroupEditor.tsx`, `ScheduleEmployeePicker.tsx`, `ResolvePlanGroupsList.tsx`, `ImportSchedulePlanSummary.tsx`, `SchedulePlanPreviewDialog.tsx`, `WeeklyScheduleSheet.tsx`, `WeeklyScheduleTemplatePickerDialog.tsx`.
- **D — Dialogs**: `ClearAllSchedulesDialog.tsx`, `ClearEmployeeScheduleDialog.tsx`, `ClearSitePatternsDialog.tsx`, `RunEngineDialog.tsx`, `SpreadsheetImportDialog.tsx`.
- **E — Misc**: `DeviceAlerts.tsx`, `EmployeePicker.tsx`, `EmployeeAvatar.tsx`, `AttendanceToolbar.tsx`, `AttendanceLoading.tsx`, `AppTooltip.tsx`, `ImportSchedulePlanSummary.tsx` (if not in C).

## Per-cluster process

1. For each file: read it; apply the mapping by meaning; remove `dark:`; keep diffs surgical.
2. Verify no off-brand hue remains in the cluster: `grep -nE "(emerald|sky|amber)-[0-9]|dark:" <files>` → expect empty (or justified).
3. `npm run test:web` stays green (existing 65 tests; guards don't scan these screens, so this just confirms nothing else broke).
4. Commit the cluster's source files only.

## Finalize (after all clusters)

1. Repo-wide check: `grep -rnE "(emerald|sky|amber|lime|teal|cyan|indigo|violet|rose)-[0-9]|dark:" src/ui` → empty.
2. `npm run build` (confirms every new token utility generates; catches typos).
3. Commit the rebuilt bundle (`public/hr_attendance/**`).
4. Final whole-branch review (opus) over the Phase 2 range.

# Rollout Punch List

Single source of truth for pre-rollout readiness. Spec:
`docs/superpowers/specs/2026-07-03-pre-rollout-readiness-design.md`.

Rollout is ready when **Must fix** is empty, every **Should fix** has a recorded
decision, and the launch checklist (spec Phase 4) has passed once against prod.

**Entry format:**
`- [ ] **[T<track>-<n>]** <title> — <evidence: screenshot path or repro note> (found <date>; PR —)`

Tracks: T1 = UI walk, T2 = data trust, T3 = failure/permissions/deploy.

## Must fix

_(pending triage — see Untriaged)_

## Should fix

_(pending triage — see Untriaged)_

## Can wait

_(pending triage — see Untriaged)_

## Untriaged

- [ ] **[T2-1]** ADMS Bridge service account appears in HR employee pickers —
  selectable in `/hr-attendance` and `/hr-schedule` pickers; search fix (#57)
  stopped it polluting results but it is still listed. Decide API-level
  exclusion in `hr_calendar.py`. (found 2026-07-02; PR —)
- [ ] **[T2-2]** Fresh prod import problems CSV not yet verified — expect only
  the ~4 known bad-badge `EMPLOYEE_NOT_FOUND` rows. **Blocked on user** re-running
  the prod import and sharing the CSV. (found 2026-07-02; PR —)
- [ ] **[T3-1]** ~10 stray screenshot PNGs untracked at repo root (`di-home*.png`,
  `mine-final*.png`, `render-*.png`, …) — delete or gitignore; risk of an
  accidental commit. (found 2026-07-03; PR —)
- [ ] **[T1-1]** Phone 375px: 7-column week grid is unreadable — day-of-week labels
  clip ("Tue" renders as "ue", "Today" renders as "Bod...ay"), time sub-labels
  truncate to "8:11...", shift bars collapse to hairlines — `e2e/.audit-shots/phone-attendance-baseline.png`,
  scenario `baseline`, phone. (found 2026-07-03; PR —)
- [ ] **[T1-2]** api-error state: error banner contains a redundant "There was an
  error." secondary line that adds no information, and there is no retry button on
  the banner itself (only the small refresh icon in the header toolbar is
  available); additionally the calendar renders "Day off" in every column below
  the error, which looks like stale data rather than a loading failure —
  `e2e/.audit-shots/laptop-attendance-api-error.png`, scenario `api-error`, laptop. (found 2026-07-03; PR —)
- [ ] **[T1-3]** `no-schedule` state (employee with `has_shift_assignment: false`)
  renders identically to `empty-week` (scheduled employee, no work days) — both
  show "Day off" grid with pink header and no explanatory copy; an HR user
  onboarding a new employee cannot tell whether the view reflects a configured
  week off or a missing schedule that needs setup —
  `e2e/.audit-shots/laptop-attendance-no-schedule.png`, scenario `no-schedule`, laptop. (found 2026-07-03; PR —)
- [ ] **[T1-4]** Phone 375px: `/hr-schedule` shift-block editor inaccessible — four
  header action buttons (Import, Clear schedule, Clear all, Wipe patterns) stack
  vertically at mobile width, consuming ~55% of the viewport; the
  WeekPatternGroupEditor inside the `flex min-h-0 flex-1` card is squeezed to zero
  visible height, leaving only the card title "Shift blocks" visible between the
  header and the footer. HR cannot view or edit any shift blocks on phone —
  `e2e/.audit-shots/phone-schedule-baseline.png`, scenario `baseline`, phone. (found 2026-07-03; PR —)

## Triage decisions log

_(user decisions recorded here: entry id → bucket, date, rationale)_

## Launch checklist record

_(completed once, per spec Phase 4)_

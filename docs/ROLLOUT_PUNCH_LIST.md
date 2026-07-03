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
- [ ] **[T1-5]** Three destructive dev buttons ("Clear schedule (dev)", "Clear all (dev)", "Wipe patterns (dev)") are visible to any HR user in the schedule header with no dev-only gating — rendered unconditionally in `WeeklySchedulePage.tsx` lines 351–375, with button labels defined in `ClearEmployeeScheduleDialog.tsx:132`, `ClearAllSchedulesDialog.tsx:117`, `ClearSitePatternsDialog.tsx:122`; no `import.meta.env.DEV` check or role check exists anywhere in those files. An HR user could wipe an employee's schedule or all site shift patterns; gating decision required before rollout — `e2e/.audit-shots/laptop-schedule-wizard-loaded.png`, scenario `baseline`, laptop. (found 2026-07-03; PR —)
- [ ] **[T3-2]** Bridge punch stasis is invisible: no consumer checks wall-clock freshness of Device Sync Status — `device_sync.py:153` writes the watermark; `hr_calendar.py:478` reads it; `attendancePunches.ts:211` only flags lag when `pending_count > 0` or `last_device_log_at > last_delivered_at` within the frozen row, never against wall clock; no scheduler audits DSS row age; no push/email/notification fires; only signal is UNNOTIFIED_ABSENCE flags ~18 h later. (found 2026-07-03; PR —)
- [ ] **[T3-3]** Missed closeout webhook → employees with checkins silently get no final flags — `run_company_fallback_closeout` (closeout.py:82) skips employees with any checkins (closeout.py:261), so LATE_START/LEFT_EARLY/MISSING_TIME are never written if the Bridge closeout never calls `notify_device_closeout_status` (closeout.py:121); no Device Closeout Alert row is created so no "!" badge in the SPA; no push, email, or desk notification fires. (found 2026-07-03; PR —)
- [ ] **[T3-4]** Scheduler death has no dead-man's switch in app code — `*/30` intraday (hooks.py:111) and `daily` fallback closeout (hooks.py:108) stopping produces no heartbeat failure, no email, no push, no notification; no job audits last-ran-at; Frappe Cloud infra may alert on worker death but this is outside app code and cannot be verified from code alone. (found 2026-07-03; PR —)

## Triage decisions log

_(user decisions recorded here: entry id → bucket, date, rationale)_

## Launch checklist record

_(completed once, per spec Phase 4)_

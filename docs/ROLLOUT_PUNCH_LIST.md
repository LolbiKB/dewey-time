# Rollout Punch List

Single source of truth for pre-rollout readiness. Spec:
`docs/superpowers/specs/2026-07-03-pre-rollout-readiness-design.md`.

Rollout is ready when **Must fix** is empty, every **Should fix** has a recorded
decision, and the launch checklist (spec Phase 4) has passed once against prod.

**Entry format:**
`- [ ] **[T<track>-<n>]** <title> — <evidence: screenshot path or repro note> (found <date>; PR —)`

Tracks: T1 = UI walk, T2 = data trust, T3 = failure/permissions/deploy.

## Status (2026-07-03)

Backup-independent audit tracks are **complete**: UI walk (T1) and
failure-visibility + deploy/rollback tracing (T3). 15 findings recorded, triaged
into the buckets below — **buckets are `(proposed)` pending the user's final
triage** (spec Phase 2 gate).

**Still pending — need the anonymized prod seed** (`dev/sandbox` seeded from a
Frappe Cloud backup): the data-trust track (flag correctness on 2 real weeks,
ADMS Bridge listing root-cause extending T2-1, import cleanliness T2-2) and the
live permissions probe. Those findings will be added here as follow-up commits
on the same PR. Counts below will grow once that half runs.

Bucket counts (proposed, backup-independent findings only): Must fix 3 ·
Should fix 7 · Can wait 3 · Pending user/sandbox 2.

## Must fix _(proposed)_

- [ ] **[T1-5]** Three destructive dev buttons ("Clear schedule (dev)", "Clear all (dev)", "Wipe patterns (dev)") are visible to any HR user in the schedule header with no dev-only gating — rendered unconditionally in `WeeklySchedulePage.tsx` lines 351–375, with button labels defined in `ClearEmployeeScheduleDialog.tsx:132`, `ClearAllSchedulesDialog.tsx:117`, `ClearSitePatternsDialog.tsx:122`; no `import.meta.env.DEV` check or role check exists anywhere in those files. An HR user could wipe an employee's schedule or all site shift patterns; gating decision required before rollout. _Proposed must-fix: mitigated by typed-name confirm dialogs, but "Clear all"/"Wipe patterns" are one-click-reachable in prod._ — `e2e/.audit-shots/laptop-schedule-wizard-loaded.png`, scenario `baseline`, laptop. (found 2026-07-03; PR —)
- [ ] **[T3-3]** Missed closeout webhook → employees with checkins silently get no final flags — `run_company_fallback_closeout` (closeout.py:82) skips employees with any checkins (closeout.py:261), so LATE_START/LEFT_EARLY/MISSING_TIME are never written if the Bridge closeout never calls `notify_device_closeout_status` (closeout.py:121); no Device Closeout Alert row is created so no "!" badge in the SPA; no push, email, or desk notification fires. _Proposed must-fix: silent data-completeness loss; flags HR relies on just never appear._ (found 2026-07-03; PR —)
- [ ] **[T1-1]** Phone 375px: 7-column week grid is unreadable — day-of-week labels clip ("Tue" renders as "ue", "Today" renders as "Bod...ay"), time sub-labels truncate to "8:11...", shift bars collapse to hairlines — `e2e/.audit-shots/phone-attendance-baseline.png`, scenario `baseline`, phone. _Proposed must-fix IF HR uses phones for daily review; downgrade to should-fix if attendance review is laptop-only._ (found 2026-07-03; PR —)

## Should fix _(proposed)_

- [ ] **[T1-2]** api-error state: error banner contains a redundant "There was an error." secondary line that adds no information, and there is no retry button on the banner itself (only the small refresh icon in the header toolbar is available); additionally the calendar renders "Day off" in every column below the error, which looks like stale data rather than a loading failure — `e2e/.audit-shots/laptop-attendance-api-error.png`, scenario `api-error`, laptop. _Proposed should-fix, leaning high: the fake "Day off" grid under an error is a trust risk._ (found 2026-07-03; PR —)
- [ ] **[T1-3]** `no-schedule` state (employee with `has_shift_assignment: false`) renders identically to `empty-week` (scheduled employee, no work days) — both show "Day off" grid with pink header and no explanatory copy; an HR user onboarding a new employee cannot tell whether the view reflects a configured week off or a missing schedule that needs setup — `e2e/.audit-shots/laptop-attendance-no-schedule.png`, scenario `no-schedule`, laptop. (found 2026-07-03; PR —)
- [ ] **[T1-4]** Phone 375px: `/hr-schedule` shift-block editor inaccessible — four header action buttons (Import, Clear schedule, Clear all, Wipe patterns) stack vertically at mobile width, consuming ~55% of the viewport; the WeekPatternGroupEditor inside the `flex min-h-0 flex-1` card is squeezed to zero visible height, leaving only the card title "Shift blocks" visible between the header and the footer. HR cannot view or edit any shift blocks on phone — `e2e/.audit-shots/phone-schedule-baseline.png`, scenario `baseline`, phone. _Proposed should-fix: the schedule wizard is likely a laptop admin task; raise to must-fix if used on phones._ (found 2026-07-03; PR —)
- [ ] **[T2-1]** ADMS Bridge service account appears in HR employee pickers — selectable in `/hr-attendance` and `/hr-schedule` pickers; search fix (#57) stopped it polluting results but it is still listed. Decide API-level exclusion in `hr_calendar.py`. _Data-trust track will confirm the exact Employee record + exclusion method (Task 9)._ (found 2026-07-02; PR —)
- [ ] **[T3-2]** Bridge punch stasis is invisible: no consumer checks wall-clock freshness of Device Sync Status — `device_sync.py:153` writes the watermark; `hr_calendar.py:478` reads it; `attendancePunches.ts:211` only flags lag when `pending_count > 0` or `last_device_log_at > last_delivered_at` within the frozen row, never against wall clock; no scheduler audits DSS row age; no push/email/notification fires; only signal is UNNOTIFIED_ABSENCE flags ~18 h later. (found 2026-07-03; PR —)
- [ ] **[T3-4]** Scheduler death has no dead-man's switch in app code — `*/30` intraday (hooks.py:111) and `daily` fallback closeout (hooks.py:108) stopping produces no heartbeat failure, no email, no push, no notification; no job audits last-ran-at; Frappe Cloud infra may alert on worker death but this is outside app code and cannot be verified from code alone. (found 2026-07-03; PR —)
- [ ] **[T3-6]** No rollback procedure is documented anywhere — `HR_ATTENDANCE_DEPLOY.md` covers 404/MIME troubleshooting only; the expected procedure for a broken prod deploy (revert merge commit → merge revert → FC deploy → `bench migrate` re-syncs old committed assets) is undocumented; add a ROLLBACK section to `HR_ATTENDANCE_DEPLOY.md`. (found 2026-07-03; PR —)

## Can wait _(proposed)_

- [ ] **[T3-1]** ~10 stray screenshot PNGs untracked at repo root (`di-home*.png`, `mine-final*.png`, `render-*.png`, …) — delete or gitignore; risk of an accidental commit. _Trivial cleanup, do anytime._ (found 2026-07-03; PR —)
- [ ] **[T3-5]** `HR_ATTENDANCE_DEPLOY.md` never warns that CI does NOT rebuild the bundle — `.github/workflows/frontend.yml` runs only `test:web` and `test:e2e`; merging a frontend PR without first running `npm run build` locally and committing the output ships stale assets to prod with no CI gate to catch it. _Should-fix-adjacent: known footgun; folding a warning into the deploy doc alongside T3-6 closes it cheaply._ (found 2026-07-03; PR —)
- [ ] **[T3-7]** Schema patches that ran during a deploy cannot be undone by git revert — `dewey_time/patches.txt` includes behavior-altering patches (`reset_shift_type_naming_to_prompt`, `disable_schedule_naming_server_scripts`) that delete Property Setters and disable Server Scripts; these DB-side changes persist after a code rollback, so rolling back to a prior commit may leave the DB in a state the old code did not expect. _Document as a rollback caveat under T3-6._ (found 2026-07-03; PR —)

## Pending — user action / sandbox tracks

- [ ] **[T2-2]** Fresh prod import problems CSV not yet verified — expect only the ~4 known bad-badge `EMPLOYEE_NOT_FOUND` rows. **Blocked on user** re-running the prod import and sharing the CSV. (found 2026-07-02; PR —)
- [ ] **[T3-8]** USER CHECK — confirm in the Frappe Cloud dashboard that scheduled offsite backups are enabled and a recent backup exists for the prod site before rollout; cannot be verified from code. (found 2026-07-03; PR —)
- [ ] **[TRACK]** Data-trust flag-correctness (spec Track 2 / plan Tasks 5–8), ADMS Bridge listing root-cause (Task 9), import cleanliness structural checks (Task 10), and live permissions probe (Task 12) — **pending the anonymized prod seed** (`fetch_backup.py` → `frappe-sandbox seed --prod`). Findings to be appended here.

## Triage decisions log

_(user decisions recorded here: entry id → bucket, date, rationale)_

## Launch checklist record

_(completed once, per spec Phase 4)_

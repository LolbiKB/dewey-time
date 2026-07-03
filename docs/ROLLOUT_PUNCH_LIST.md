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

## Triage decisions log

_(user decisions recorded here: entry id → bucket, date, rationale)_

## Launch checklist record

_(completed once, per spec Phase 4)_

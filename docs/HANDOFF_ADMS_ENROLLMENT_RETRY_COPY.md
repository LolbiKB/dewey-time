# Handoff — ADMS enrollment "timeout / retrying" reads as failure mid-scan

**Repo:** this one (`dewey-time`), ADMS frontend at `dewey_time/frontend/adms`.
**Origin:** ported from the bridge repo (`dewey-time-bridge`), where the backend half is already
**merged + deployed** (PR #15, `EARLY_RECOVERY_AFTER_MS` 45s→150s). Bridge-side companion doc:
`docs/handoffs/2026-07-27-dashboard-enrollment-retry-copy.md` in dewey-time-bridge.

## Symptom
Enrolling a fingerprint shows **"Taking longer than expected…"** (reads as a timeout) and a
**"Pulling template…" / "Request template from device"** retry affordance, and then enrollment
**succeeds anyway**. Nothing failed — the operator was simply still scanning at the device.

## Why (root cause is split across two layers)

A fingerprint enrollment (walk to device + 3 presses + occasional bad-read retries) routinely takes
**longer than 30–45s**. Two independent timers fire inside that normal window:

1. **Frontend — the dominant driver.** In `src/components/users/user-detail-modal.tsx`:
   - A **30s** timer flips the timeout banner on for *any* in-progress phase, including plain
     `enrolling`:
     ```ts
     // ~line 474
     useEffect(() => {
       if (phase !== 'idle' && phase !== 'success' && phase !== 'failed') {
         const timer = setTimeout(() => setShowTimeout(true), 30000) // <-- fires mid-scan
         return () => clearTimeout(timer)
       }
       setShowTimeout(false)
     }, [phase])
     ```
     …rendered at ~line 849 as `showTimeout && (phase === 'enrolling' || phase === 'accepted')` →
     *"Taking longer than expected…"* (enrolling) / *"Upload is taking longer than expected…"*
     (accepted).
   - A **45s** client-side auto-recovery that calls the recovery endpoint directly:
     ```ts
     // ~line 493
     const timer = setTimeout(async () => { ... UserService.triggerEnrollmentRecovery(user.id!) ... }, 45000)
     ```
     (Only fires once `rawPhase === 'accepted'`, so it's usually dormant for a plain fingerprint
     enroll where the ENROLL command stays `sent` — but the threshold should still be aligned.)

2. **Backend — already fixed.** `processEarlyEnrollmentRecovery` used to fire a template-pull
   `DATA QUERY` at 45s, which set `recovery_queued_at` → the UI's `isPullingTemplate` → the
   "Pulling template…" copy. The bridge now waits **150s** (PR #15), so this no longer flips
   mid-scan. **The 30s frontend banner is unaffected by that fix and is now the primary remaining
   cause.**

There is no device signal between "enroll UI opened" and "template uploaded", so short timers
cannot distinguish *still-scanning* from *stuck*. Both layers must use a window that exceeds a
realistic interactive scan.

## The change (frontend only)

In `src/components/users/user-detail-modal.tsx`:

1. **Raise the timeout banner window 30s → 150s** (match the backend's `EARLY_RECOVERY_AFTER_MS`),
   and prefer extracting a named constant (there's precedent: `ENROLL_PROCESS_MIN_MS`), e.g.
   `ENROLL_SLOW_HINT_MS = 150_000`.
2. **Reframe the copy** so an in-progress enrollment never reads as a failure:
   - `enrolling`: current *"Taking longer than expected…"* → e.g. **"Waiting for the user to scan
     at the device…"** (calm, informational — not an `AlertCircle`/attention style until the raised
     threshold is genuinely exceeded).
   - `accepted`: current *"Upload is taking longer than expected…"* is acceptable as a *late* hint,
     but only after the 150s window.
3. **Align the client-side auto-recovery 45s → 150s** (or remove it — the backend now auto-recovers
   at 150s, so the client trigger is largely redundant; at minimum it must not fire before the scan
   window). Keep the manual **"Request template from device"** button available for the genuinely
   stuck case.
4. Leave `deriveEnrollPhase` / `isPullingTemplate` logic as-is — `isPullingTemplate` correctly maps
   to `accepted` with a spinner; it is **not** a failure signal and should never be styled as one.

## TDD
`src/lib/enrollment-phase.test.ts` already covers the phase mapping. Add a modal-level test (or an
e2e in `e2e/`) asserting the timeout banner does **not** appear before the raised threshold for a
plain `enrolling` session — red at 30s, green at 150s — mirroring the bridge's
`enrollment-session.test.ts` regression guard.

## Verify
1. Start a fingerprint enrollment; take ~30–90s at the device. The dialog stays on a calm
   "waiting for scan" state and flips to success — **no "taking longer than expected" banner, no
   "Pulling template…" flash.**
2. Slow path (>2.5 min): a gentle late hint may appear; it must still read as in-progress, not a
   failure, until the template lands or the session hits a terminal phase (`failed` / `timed_out`
   / `cancelled`).

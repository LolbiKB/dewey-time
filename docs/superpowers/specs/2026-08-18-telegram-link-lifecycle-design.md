# Telegram link lifecycle — design

**Date:** 2026-08-18
**Supersedes parts of:** `2026-08-15-telegram-employee-layer-design.md` (the issue-a-link half)

## Problem

Issuing a Telegram link is the credential-minting operation of the whole
Telegram feature: whoever opens the link binds *their* Telegram account to the
named employee's record, gaining that employee's attendance history, check-in
times and branch locations through the Mini App.

Today that operation is spread across two surfaces and is missing most of its
lifecycle:

1. **Two surfaces mint the same credential.** The `/hr-attendance` toolbar
   (`AttendanceToolbar.tsx:117`) and the `/hr-schedule/coverage` register
   (`registerColumns.tsx:344`) both call `useTelegramInvite` →
   `create_link_invite`. Two places to reason about, two places to change.
2. **Re-issuing never invalidates the previous token.** Each click mints
   another independently-redeemable credential; all of them stay live until
   their own expiry. There is no revocation path at all.
3. **`create_link_invite` does not refuse an already-linked employee.** The
   register hides its button when `telegram === "linked"`, but the API does
   not, so a second live credential can be minted for someone already bound.

   **Corrected after the whole-branch review (2026-08-18).** An earlier draft
   of this spec claimed the second account would then get a *second* enabled
   `Telegram Link` row and be authorised alongside the first. It would not:
   `TelegramLink.validate` already refuses a second enabled link for one
   employee, and `_create_link` inserts through the document API, so the
   controller runs. The real cost of the missing refusal is a live credential
   that should never have been minted, and a redemption that fails with a
   controller throw rather than a legible message — not a double binding.
4. **`expires_at` is computed twice** — once inside `issue_link_token`, again
   in `create_link_invite` — so the value returned is not the value stored,
   and it arrives as a naive site-local string the browser cannot turn into an
   instant.
5. **The dialog promises "or let them scan it" and renders no QR.** There is
   no QR code anywhere in the repository.
6. **The TTL is 168 hours** for a credential the copy describes as
   short-lived.
7. **A single stray click mints a live credential**, with no confirmation step
   anywhere.

## Goals

- One surface owns the Telegram link lifecycle: the coverage register.
- Issue, regenerate, and unlink are all reachable from that one surface, and
  each leaves at most one live credential per employee.
- Redemption fails closed on every path that could produce two authorised
  accounts for one employee.
- HR can see, at a glance and in real time, whether the link on screen is
  still live.

## Non-goals

- **No typed short code.** The credential stays a `t.me` deep link. A short
  code would need webhook changes to parse bare text plus a separate
  rate-limited store, and buys nothing once a QR exists.
- **No configurable TTL.** 24 hours is hardcoded. A settings field nobody
  tunes is a migration, a validation path and a second source of truth for no
  benefit.
- **No `linked_at` on the register feed.** The linked state of the dialog
  shows no date. Adding one means widening
  `coverage_api._telegram_status_by_employee` from `dict[str, str]` to a dict
  of dicts, and nothing in the flow needs the date.
- **`/hr-schedule/coverage?employee=<id>` stays inert.** Nothing navigates to
  coverage with that parameter — traffic goes the other way, coverage →
  `/hr-attendance?employee=`. A deep-link nobody requested is not built here.
- **No expiry sweep / cleanup job** for old token rows. They are the audit
  trail.

## Global constraints

- `DEFAULT_TTL_HOURS = 24` (was `168`).
- `TOKEN_BYTES = 32` — unchanged. 43 base64url chars, inside Telegram's
  64-char `start` payload limit.
- Every new whitelisted endpoint is `methods=["POST"]` and calls
  `_require_hr_role()` first, matching `create_link_invite`.
- Token rows are **never deleted**. Revocation is a stamped field.
- The QR is rendered client-side. The encoded value is the credential and must
  never reach a hosted QR service.
- Any DocType JSON change **must** bump that JSON's `modified` timestamp, or
  `bench migrate` skips the schema reimport on this bench.
- `test:web` in `dewey_time/frontend/hr_attendance/package.json` is an
  explicit per-directory glob list, not a recursive one. Any new test
  directory must be added there or its tests silently never run while the
  suite still reports green.
- Built SPA assets under `dewey_time/public/**` and `dewey_time/www/*.html`
  are the deployed artifact and must be committed; Frappe Cloud does not build
  them.

---

## Backend

### Data model

`Telegram Link Token` gains one field:

| fieldname    | fieldtype | properties            |
|--------------|-----------|-----------------------|
| `revoked_at` | Datetime  | `read_only: 1`        |

Appended to the end of `field_order`, after
`redeemed_by_telegram_user_id`, so the redeemed pair stays adjacent.
Description: *"Set when a newer
link superseded this one, or when the employee was unlinked. A revoked token
can never be redeemed. The row is kept so the audit trail survives."*

The JSON's `modified` is bumped to `2026-08-18 12:00:00.000000`.

Rows are never deleted: a token that was issued and then superseded is the
record of what HR did.

### `dewey_time/telegram/binding.py`

**`DEFAULT_TTL_HOURS = 24`.**

**`issue_link_token` returns a NamedTuple, not a string.**

```python
class IssuedToken(NamedTuple):
    token: str
    expires_at: datetime  # from add_to_date
```

The caller needs the stored expiry. Returning it removes the second
`now_datetime()` read in `create_link_invite` and with it the drift between
the value stored and the value reported.

**New `revoke_outstanding_tokens(employee) -> int`.** Stamps `revoked_at =
now_datetime()` on every `Telegram Link Token` for `employee` where
`redeemed_at` is unset and `revoked_at` is unset. Returns how many it
revoked.

`issue_link_token` calls it **before** minting. This *is* regeneration —
there is no separate regenerate endpoint, because re-issuing has to mean
"the previous one stops working" or the operation is not safe to offer.

**`_load_token` also selects `revoked_at`.**

**`redeem_link_token` gains three refusals and one revive.** The order is
load-bearing: Telegram redelivers an update when it does not get a timely
200, so the same-account idempotency branch must keep winning.

1. unknown token — unchanged
2. redeemed by the **same** Telegram account — unchanged, returns the employee
3. redeemed by a different account — unchanged, refuses
4. **NEW** `revoked_at` set → `"This link is no longer valid. Ask HR for a
   new one."`
5. expired — unchanged
6. **NEW** `_employee_bound_elsewhere(row["employee"], telegram_user_id)` →
   `"This employee is already linked to another Telegram account. Ask HR."`

   Checked **before** the account-level branches below, so the revive branch
   cannot revive an account into a second live binding for one employee.
7. **NEW** `_existing_link(telegram_user_id)` — three branches:
   - exists, `enabled`, employee **is** this token's employee → mark the
     token redeemed and return that employee. The account is already
     correctly bound; creating a second row would raise `DuplicateEntryError`
     on the `field:telegram_user_id` autoname.
   - exists, `enabled`, employee is **someone else** → `"This Telegram
     account is already linked. Ask HR."`
   - exists, **disabled** → revive it. Set `employee` to this token's
     employee, `chat_id` to this update's chat, `enabled = 1`, `linked_at =
     now_datetime()`, `linked_via = "token"`. Then mark the token redeemed
     and return.

   The revive branch matters more than it looks. `Telegram Link` autonames
   `field:telegram_user_id`, so the row for an account survives unlinking
   forever. Telegram accounts are keyed to a phone number, so "employee got a
   new phone" is usually the *same* account — and without this branch the
   unlink → re-issue flow this design exists to build would be permanently
   broken for exactly the case that motivates it.

   This deliberately differs from `claim_by_recorded_id`, which refuses a
   revoked link outright ("A REVOKED link must stay revoked"). That guard
   protects the *no-token* path, where nothing but the employee reopening the
   bot is required; letting it self-restore would make revocation theatre.
   A token is HR's explicit, freshly-minted authorisation to bind this
   employee, which is the thing the recorded-id path lacks. The two paths
   should not agree here.
8. create the link, mark redeemed — unchanged

Both reuse the helpers `claim_by_recorded_id` already depends on.

Guard 6 is **load-bearing for the revive branch specifically**, and the
reasoning is worth pinning because the guard reads as redundant.
`TelegramLink.validate` refuses a second enabled link for one employee, but it
only runs on the document API. `_create_link` inserts, so it is covered.
`_revive_link` points an *existing* row at a *different* employee, which is
the write that most needs the check — so it must save through the document
API too, never `frappe.db.set_value`. Guard 6 then does two further jobs:
it stops the revive being attempted at all, and it returns a legible reason
instead of a controller throw.

**`create_link_invite(employee)`** — POST, HR-only, same call signature.

Its whitelist becomes `methods=["POST"]`. It is a bare `@frappe.whitelist()`
today, so the GET that `services/telegram.ts` documents it as refusing is in
fact accepted — the client sends POST, and nothing makes the server insist.

- Refuses when the employee already has an enabled `Telegram Link`:
  `"{employee} is already linked to Telegram. Unlink first to issue a new
  link."`
- Resolves `_bot_username()` before minting — unchanged, and still the reason
  a misconfigured username does not burn a token.
- Returns:

```python
{
    "employee": employee,
    "url": link_url(issued.token, bot),
    "expires_at": str(issued.expires_at),
    "expires_in_seconds": DEFAULT_TTL_HOURS * 3600,
}
```

`expires_in_seconds` is the TTL by construction, **not** a subtraction of two
datetimes. Two reasons. A naive site-local datetime string cannot be turned
into an instant by a browser that does not know the site timezone. And the
frappe test mock's `get_datetime` is an identity passthrough, so datetime
arithmetic here would go untested — string-vs-datetime bugs would stay green.

**New `revoke_link(employee) -> dict`** — whitelisted, POST, HR-only.

1. `_require_hr_role()`
2. `employee = (employee or "").strip()`; blank → `frappe.throw("employee is
   required")`
3. For every `Telegram Link` with this employee and `enabled = 1`: set
   `enabled = 0` **through `frappe.get_doc(...)` + `doc.save()`**, never
   `frappe.db.set_value`. The row and its version history are kept — the
   field's own description already promises this — but the doctype is
   `track_changes: 1` and Versions are written by `Document.save()`.
   `set_value` goes straight to SQL, so a programmatic unlink would silently
   stop recording who revoked a credential and when, which the desk path this
   endpoint replaces did record.
4. `revoke_outstanding_tokens(employee)` — an unlink must not leave a live
   credential behind.
5. Returns `{"employee": employee, "unlinked": <count>, "tokens_revoked":
   <count>}`

Idempotent: an employee with no live link returns `unlinked: 0` rather than
throwing, so a second press from a stale tab is not an error.

### Backend tests — `dewey_time/tests/test_telegram_binding.py`

Existing tests that call `issue_link_token` and expect a string update to
`.token`. New coverage:

- issuing revokes the employee's outstanding unredeemed tokens
- issuing does **not** revoke another employee's tokens
- issuing does **not** touch an already-redeemed token
- a revoked token is refused at redemption
- `create_link_invite` refuses an already-linked employee
- `create_link_invite` returns `expires_in_seconds == 86400`
- redemption by an account already linked to the *same* employee marks the
  token redeemed and returns, without creating a second row
- redemption by an account already linked to a *different* employee refuses
- redemption refuses when the employee is already bound to another account
- redemption **revives** a disabled link for the same account, repointing
  employee and chat_id and setting `linked_via = "token"`
- the employee-bound-elsewhere guard is checked before the revive, so a
  revive cannot produce two live bindings for one employee
- `claim_by_recorded_id` still refuses a revoked link — the existing
  `test_a_revoked_link_is_not_silently_restored` must stay green, and is the
  contrast that makes the revive branch legible
- `revoke_link` clears `enabled` and revokes outstanding tokens
- `revoke_link` on an unlinked employee returns `unlinked: 0`, no throw
- `revoke_link` requires the HR role

---

## Frontend

### Removed from `/hr-attendance`

`src/ui/AttendanceToolbar.tsx`:

- drop the `TelegramLinkButton` / `TelegramLinkDialog` import (line 24) and
  the `useTelegramInvite` import (line 25)
- drop `const telegramInvite = useTelegramInvite()` and its comment (67-68)
- drop the divider + `<TelegramLinkButton>` segment (116-120)
- drop the trailing `<TelegramLinkDialog>` block (229-236)

`selectedEmployee` stays — `WeeklyScheduleSummary` still consumes it. The
`hrStaff` fragment stays for the same reason.

`TelegramLinkButton` — the `h-auto min-h-14 w-11` toolbar-shaped button — is
**deleted**. The register has always drawn its own compact row button, so
nothing else uses it.

### The row control

`registerColumns.tsx`, the `telegram` column:

- badge unchanged
- `telegram === null` still renders `—` and **no** button. No feed vouched for
  the fact, so there is nothing to manage.
- for `linked`, `id_on_file` and `none`, one icon-only ghost button,
  `size-7 shrink-0 p-0`, wrapped in `AppTooltip`
- accessible name: `Manage Telegram for {employee_name}` — per row, because
  what is being chosen is which employee gets a credential
- icon: `SendIcon` for the unlinked states, `LinkIcon` for `linked`
- tooltip: `"Manage Telegram"`
- the click opens the dialog and **mints nothing**

The column width budget is unchanged: the cell still holds one badge and one
`size-7` button.

### `TelegramDialog`

Titled `Telegram — {employeeName}`. One component, five bodies.

**`not-linked`** (`telegram` is `none` or `id_on_file`, nothing issued yet)

- what issuing does, and the forwarding warning
- when the row is `id_on_file`, an additional line: *"This employee has a
  Telegram ID on file. They can link by opening the bot and sending /start —
  no link needed. Issue one only if that fails."* This is true today:
  `claim_by_recorded_id` is live and `webhook._handle` already calls it on a
  bare `/start`. Nothing currently tells HR, so they issue links people do
  not need.
- primary button `Issue link`

**`issuing`** — "Issuing a link…", and no stale URL from a previous employee.

**`issued`**

- QR panel
- the URL in a `readOnly` input (not `disabled` — `navigator.clipboard` needs
  a secure context, and hand-selection is the fallback) with a Copy button
- live countdown
- the existing forwarding warning, verbatim
- `Regenerate`, with its consequence beside it: the link above stops working

**`expired`** — reached when the countdown hits zero with the dialog open. The
URL and the QR are **replaced** by "This link has expired." and `Regenerate`.
A dead credential must not keep rendering as if it were live.

**`linked`**

- "This employee is linked to Telegram."
- destructive `Unlink`
- pressing it swaps this body in place for a confirm — *"Unlink {name}? They
  lose Mini App access and notifications until a new link is issued."* — with
  Cancel and Unlink. In place, not a nested dialog: there is no
  `alert-dialog` primitive in `src/components/ui/`, and stacked Radix dialogs
  bring focus-trap problems of their own.
- on success the body becomes `not-linked`, so unlink → issue is one
  continuous flow. That is the changed-phone case, end to end.

### Data refresh

After a successful `revoke_link`, invalidate `queryKeys.coverage.all` so the
badge updates. After a successful issue, **do not** — nobody is linked until
the token is redeemed, so the register's state has not changed.

### Countdown

`expires_in_seconds` arrives with the invite. The client pins
`deadlineMs = Date.now() + expires_in_seconds * 1000` **once**, at receipt.

A 1-second interval runs **only** while the dialog is open with a live,
unexpired invite, and is torn down on close and on expiry. Stated explicitly
because the Mini App currently carries the inverse bug — a `now` pinned at
mount by a `useMemo` whose dependency can never change.

`src/ui/telegram/expiry.ts` holds the pure formatter, and it is where the
logic is tested — no timers involved:

```ts
export function formatCountdown(secondsRemaining: number): string
```

- `>= 3600` → `"23h 41m"` (`>` would print `"60m 0s"` at exactly an hour)
- `< 3600` → `"41m 12s"`
- `<= 0` → `"Expired"` — including negative input, which a laptop that slept
  past the deadline wakes up with

### QR

`react-qr-code` — zero runtime dependencies, ~4KB, renders inline SVG, ships
its own types. If the dependency audit rejects it, `qrcode-generator` is the
fallback; a hosted QR service is not an option at any price, because the
encoded value is the credential.

- ~200px, error correction level `M` (the URL is ~60 characters)
- **always dark modules on white, in both themes.** An inverted QR fails to
  scan on many phone cameras. The panel sets its own background rather than
  inheriting the dialog's.

### Files

Created:

```
src/ui/telegram/TelegramDialog.tsx       shell, body switch, countdown interval
src/ui/telegram/TelegramBodies.tsx       the four portal-free bodies
src/ui/telegram/TelegramLinkQr.tsx       the QR panel
src/ui/telegram/expiry.ts                formatCountdown
src/ui/telegram/expiry.test.ts
src/ui/telegram/telegramLinkQr.test.tsx
src/ui/telegram/telegramBodies.test.tsx
src/hooks/useTelegramLink.ts             issue + revoke, replaces useTelegramInvite
```

Modified: `src/services/telegram.ts` (add `revokeLink`),
`src/ui/AttendanceToolbar.tsx`, `src/ui/schedule-coverage/registerColumns.tsx`,
`src/ui/schedule-coverage/CoverageRegisterPage.tsx`,
`src/ui/coverageRegister.test.tsx`, `package.json`.

Deleted: `src/ui/TelegramLinkDialog.tsx`, `src/hooks/useTelegramInvite.ts`,
`src/ui/telegramLinkDialog.test.tsx`.

### `package.json`

`test:web` gains `src/ui/telegram/*.test.ts src/ui/telegram/*.test.tsx`.
Without this the entire new test directory never executes and the suite still
exits 0.

### Frontend tests

Carried over from `telegramLinkDialog.test.tsx`, retargeted at the new body
components:

- a loading body shows no stale link from the previous employee
- an error is shown instead of a link, never alongside one
- the link input is `readOnly` rather than `disabled`
- the forwarding warning is present on the issued body

New:

- the QR renders an `svg` whose encoded value is the invite URL
- the expired body renders neither the URL nor the QR
- the linked body offers Unlink and not Issue
- the unlink confirm requires a second press — one press changes the body,
  it does not call the endpoint
- `formatCountdown` at `86400`, `3601`, `3600`, `72`, `0`, `-5`

`coverageRegister.test.tsx` — the Telegram column tests change: a button is
now drawn for `linked` as well as `none` and `id_on_file`, `null` still draws
none, and the accessible name is `Manage Telegram for …`.

`e2e/coverage-register.spec.ts` — the round trip the unit tests structurally
cannot see: open the dialog from a row, issue, assert the QR and countdown
appear, then the unlink flow with its confirm.

## Verification

- `npm --prefix dewey_time/frontend/hr_attendance run test:web` — compare the
  printed total against the pre-change total; a drop or a flat count means
  the new directory is not in the glob
- `npm --prefix dewey_time/frontend/hr_attendance run typecheck`
- `npm --prefix dewey_time/frontend/hr_attendance run build`
- `npm --prefix dewey_time/frontend/hr_attendance run test:e2e` — **must** be
  run with `--prefix`; from the repo root Playwright resolves the `adms`
  install, prints "No tests found" and exits 0
- backend: `python3 -m unittest dewey_time.tests.test_telegram_binding`, and
  the `bench run-tests` form in CI
- built assets under `dewey_time/public/**` committed

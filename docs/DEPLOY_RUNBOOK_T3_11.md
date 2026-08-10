# Deploying T3-11 (DocType controllers)

This deploy changes how Frappe loads seven DocTypes. It is the first time any
of their controller hooks will execute against production data.

The production schema audit was **not** run before this was written, so step 2
is where it happens. Do not skip it: it is read-only, takes seconds, and is the
only thing standing between a Desk-added field and silent invisibility.

## 1. Deploy the code

Deploy as usual. Nothing changes until a migrate runs — the flip lives in the
DocType JSONs, and the guard is a patch.

## 2. Audit production BEFORE migrating (read-only)

```bash
bench --site <production-site> execute dewey_time.utils.doctype_drift_audit.run
```

Read the last line:

| Verdict | Meaning | Action |
|---|---|---|
| `DRIFT_AUDIT_CLEAR (N rows audited)` | No field would be lost. | Continue to step 3. |
| `DRIFT_AUDIT_BLOCKED` | A field exists in the database but not the app JSON. | **Stop.** Add it to the JSON, or convert it to a Custom Field, then re-audit. |
| `DRIFT_AUDIT_VACUOUS` | Every audited table is empty. | You are not on production. Check the site name. |

Also read `legacy_rows` in the JSON above that line. Non-empty
`device_sync_duplicates` or `push_subscription_duplicates` do not block the
migrate, but they are rows the newly-live validators will reject on their next
save — see step 5.

## 3. Migrate

```bash
bench --site <production-site> migrate
```

The `guard_doctype_drift_before_flip` patch re-runs the audit here and aborts
before any schema change if it finds drift. Step 2 is not redundant with it:
the patch tells you mid-migrate, step 2 tells you before you started.

## 4. Confirm the flip actually took

```bash
bench --site <production-site> execute dewey_time.utils.doctype_drift_audit.run | grep '"custom"'
```

All seven lines must read `0`. A `1` means the reimport was skipped and
**nothing has changed** — the migrate will have looked completely successful.
The cause is a `modified` timestamp that did not move; do not work around it by
editing `tabDocType` by hand, because then the JSON and the database disagree
and the next migrate is unpredictable.

## 5. What is newly live

- **`Dewey Time Settings` now rejects an incoherent rollout configuration.**
  This is the fix's main point: before today, a reversed date pair, a go-live
  with no testing start, or a duplicated branch row could be saved silently.
  If step 2 reported `settings.problems`, the *existing* configuration is
  already incoherent and the next save of that document will throw — fix the
  dates in Desk before anyone else touches it.
- **`Device Sync Status` now refuses a second row for one `(device_sn,
  local_date)`,** and names new rows `DSS-{device_sn}-{date}`. If step 2
  reported duplicates, run `device_sync.merge_device_sync_duplicates` for those
  keys first, or the next save of an affected row throws.
- **`Attendance Flag` now stamps `status_changed_by` / `status_changed_at`**
  when status changes. Rows changed before today keep their blanks; nothing
  backfills them.
- **`Attendance Flag Decision` now rejects Desk edits to a recorded decision.**
  The API path is unaffected — it already enforced the same rules before
  writing, and the guard is gated to skip inserts.
- **`Device Closeout Alert` and `Dewey Time Push Subscription` get their
  deterministic names.** Neither throws; the effect is that new rows stop
  duplicating.

Note that AUTO `Attendance Flag` rows keep their hash names. The deterministic
naming was deleted rather than revived — `flag_identity` owns stable identity,
computed from flag content.

## 6. Rollback

Revert the commit and migrate again. The JSONs go back to `"custom": 1`, Frappe
resumes substituting the base class, and the hooks go quiet.

Nothing written by the hooks needs undoing. `status_changed_by` /
`status_changed_at` and the deterministic names on rows created while the fix
was live are all additive — a row named `DSS-...` is a perfectly valid row
whether or not the controller that named it is loaded.

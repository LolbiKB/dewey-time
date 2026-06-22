# Bridge / device agent handoff — ZKTeco → Frappe attendance

**Audience:** Engineers working on the **bridge** (device poll, Supabase, Frappe delivery) and **device command** tooling.

**Purpose:** Document everything the bridge must implement or preserve so HR can trust intraday attendance timelines in `/hr-attendance`, including **sync watermarks** for open sessions.

**Frappe app repo:** `dewey_time` · Policy: [`FRAPPE_ATTENDANCE_RULES.md`](FRAPPE_ATTENDANCE_RULES.md) · Pilot: [`FLAG_ENGINE_MVP.md`](../FLAG_ENGINE_MVP.md)

---

## 1. Architecture (what you own vs Frappe)

```text
ZKTeco device logs
       ↓ poll / cmd
Bridge (your service)
       ├─→ Supabase (devices.location = Branch name, ops)
       ├─→ Frappe Employee Checkin  (per punch, idempotent)
       ├─→ Frappe Device Sync Status  (intraday watermark — NEW)
       └─→ Frappe Device Closeout Alert  (EOD — existing)
       ↓
dewey_time flag engine + HR calendar UI
```

| Layer | Source of truth | Bridge responsibility |
|-------|-----------------|------------------------|
| Punch ledger | Frappe `Employee Checkin` | Insert each log once; never delete/update history |
| Branch on punch | Supabase `devices.location` | Set `custom_device_branch` on every insert |
| Intraday “how fresh is data?” | Frappe `Device Sync Status` | POST sync watermark after poll/delivery |
| Day reconciled? | Frappe `Device Closeout Alert` | POST closeout status at EOD |
| HR flags | Frappe `Attendance Flag` | **Do not write** — Frappe engine generates from checkins + closeout |

---

## 2. What already works — do not break

### 2.1 Per-punch delivery (`Employee Checkin`)

POST to Frappe **Resource API** for DocType `Employee Checkin`.

**Required fields (MVP):**

| Field | Value |
|-------|--------|
| `employee` | Frappe Employee id/name |
| `time` | Datetime of punch (site/company TZ semantics for “day”) |
| `device_id` | Device serial — **must match** `device_sn` in sync/closeout webhooks |
| `log_type` | Often `IN` in MVP; UI infers IN/OUT from order — still send consistently |
| `skip_auto_attendance` | `1` — prevents ERP auto-creating `Attendance` |
| `custom_supabase_log_id` | **Unique** idempotency key (retry-safe) |
| `custom_device_branch` | `devices.location` from Supabase → must match Frappe `Branch.name` |
| `custom_verify_type` | Optional — device verify type |
| `custom_bridge_env` | Optional — `prod` / `staging` |

**Rules:**

- Retries must reuse the same `custom_supabase_log_id` for the same physical log.
- Missing or wrong `custom_device_branch` causes `UNKNOWN_DEVICE_BRANCH` / rogue timeline UI.
- Do not create ERPNext `Attendance` documents for device punches.

### 2.2 End-of-day closeout (existing webhook)

**Method:** `dewey_time.attendance_engine.closeout.notify_device_closeout_status`  
**HTTP:** `POST`  
**Auth:** See [§4 Authentication](#4-authentication).

**Body parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `device_sn` | yes | Device serial |
| `local_date` | yes | `YYYY-MM-DD` in attendance timezone (same as sync) |
| `status` | yes | One of: `closed`, `deferred_offline`, `closure_failed` |
| `device_branch` | recommended | Branch name (`devices.location`) |
| `last_error` | no | Error message when not `closed` |
| `undelivered` | when `status=closed` | JSON **array** of objects for logs that failed to reach Frappe |

**`undelivered[]` item shape (each object):**

Bridge already sends objects used for `DELIVERY_FAILED` flags. Include at least:

- `pin` (device user id)
- `frappe_employee_id` or `employee` (Frappe Employee id)

**Behavior on Frappe side when `status=closed`:**

- Upserts `Device Closeout Alert`
- Enqueues `generate_auto_flags_for_device_date` (final AUTO flags, `day_closed=1`)
- Uses `undelivered[]` to emit **`DELIVERY_FAILED`** per affected employee

**Statuses:**

| status | Meaning |
|--------|---------|
| `closed` | Device day closed; bridge attests delivery pass complete (with optional `undelivered`) |
| `deferred_offline` | Could not close device (offline, etc.) — day not reconciled |
| `closure_failed` | Close attempt failed |

---

## 3. NEW — Intraday sync watermark (Phase 2)

### 3.1 Why

HR calendar shows a green **open session** when an employee’s last punch is an unpaired IN (still on site). Without sync metadata, Frappe only knows punches **already inserted** — not whether the device has newer logs still in the bridge queue.

**Sync watermark** = bridge attests:

- **`last_device_log_at`** — newest log timestamp on the device for that date
- **`last_delivered_at`** — newest log timestamp successfully written to Frappe for that device+date

Frappe stores this in **`Device Sync Status`** (DocType in `dewey_time`). Bridge **POSTs** updates after each poll/delivery cycle.

### 3.2 Endpoint (live after `bench migrate`)

```
POST https://<site>/api/method/dewey_time.attendance_engine.device_sync.notify_device_sync_status
```

Until migrated on a site, bridge will see 404 and should keep retrying (~5 min on poll).

### 3.3 Request

**Headers:** Same as closeout — [§4](#4-authentication).

**Body** (JSON or form-encoded — **match whatever closeout uses today**):

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `device_sn` | yes | string | Device serial = `Employee Checkin.device_id` |
| `local_date` | yes | date | `YYYY-MM-DD` attendance day for this device |
| `device_branch` | yes | string | `devices.location` → Frappe `Branch.name` |
| `last_device_log_at` | yes | datetime | `YYYY-MM-DD HH:MM:SS` — newest log **on device** for `local_date` |
| `last_delivered_at` | yes | datetime | `YYYY-MM-DD HH:MM:SS` — newest log **inserted into Frappe** for this device+date |
| `pending_count` | no | int | Logs on device not yet delivered (bridge queue depth) |
| `last_error` | no | string | Last poll/delivery error; omit when healthy |
| `bridge_env` | no | string | `prod` / `staging` |

**Example (JSON):**

```json
{
  "device_sn": "CK92218010001",
  "local_date": "2026-06-03",
  "device_branch": "DIS Iconic",
  "last_device_log_at": "2026-06-03 14:02:15",
  "last_delivered_at": "2026-06-03 14:00:00",
  "pending_count": 0,
  "bridge_env": "prod"
}
```

**Example (curl):**

```bash
curl -X POST "https://<site>/api/method/dewey_time.attendance_engine.device_sync.notify_device_sync_status" \
  -H "Authorization: token <api_key>:<api_secret>" \
  -H "X-Bridge-Secret: <secret-if-configured>" \
  -H "Content-Type: application/json" \
  -d '{
    "device_sn": "CK92218010001",
    "local_date": "2026-06-03",
    "device_branch": "DIS Iconic",
    "last_device_log_at": "2026-06-03 14:02:15",
    "last_delivered_at": "2026-06-03 14:00:00",
    "pending_count": 2,
    "last_error": null
  }'
```

### 3.4 Expected response (Frappe)

```json
{
  "message": {
    "ok": true,
    "name": "DSS-ck92218010001-2026-06-03",
    "device_sn": "CK92218010001",
    "local_date": "2026-06-03"
  }
}
```

Errors: standard Frappe `exc` / `message` (401 auth, 400 validation).

### 3.5 Invariants bridge must maintain

1. **`last_delivered_at` ≤ `last_device_log_at`** when healthy (equal = fully caught up).
2. **Update after every delivery cycle** — whenever one or more checkins are inserted (or attempted), refresh watermarks from device cursor + delivery cursor.
3. **Heartbeat when idle** — during business hours, POST at least every **1–5 minutes** per **online** device, even if `pending_count = 0`, so HR knows the device was reachable.
4. **Device offline** — either stop posting (watermark goes stale) **or** post with unchanged `last_delivered_at`, best-known `last_device_log_at`, and `last_error` (e.g. `device_unreachable`).
5. **One logical row per (`device_sn`, `local_date`)** — upsert on `(device_sn, local_date)`; stable doc name `DSS-{scrub(device_sn)}-{local_date}`; each POST merges any legacy duplicates then `get_doc` + `save`. DB unique index on `(device_sn, local_date)`.
6. **Does not replace closeout** — keep EOD `notify_device_closeout_status` + `undelivered[]`.

### 3.6 When to call (checklist)

| Event | Action |
|-------|--------|
| Poll returned new logs and ≥1 delivered to Frappe | POST sync with updated `last_delivered_at` |
| Poll returned new logs but delivery failed | POST sync with lag (`last_device_log_at` > `last_delivered_at`) + `last_error` |
| Poll returned no new logs, device online | POST heartbeat (same timestamps or `pending_count=0`) |
| Device offline / timeout | POST with `last_error` or stop posting |
| Local date rolls at midnight (attendance TZ) | Start new `local_date` row; stop updating previous date |
| Closeout `status=closed` sent | May stop intraday sync updates for that `local_date` |

### 3.7 Internal bridge state to track

Per **`device_sn`** + **`local_date`**:

```text
device_cursor      = max(attendance_log.time) read from device for local_date
delivery_cursor    = max(checkin.time) successfully inserted into Frappe for device_id + local_date
pending            = device logs with time > delivery_cursor not yet ack'd by Frappe
```

On each cycle:

```text
last_device_log_at  = device_cursor (or null if unknown)
last_delivered_at   = delivery_cursor (or null if never delivered)
pending_count       = len(pending)   # optional but useful
```

---

## 4. Authentication

Same for **closeout** and **sync** webhooks.

1. **`Authorization` header:** `token <api_key>:<api_secret>`  
   - Frappe User with API key/secret (not Guest session cookie).

2. **Optional `X-Bridge-Secret`:**  
   - Required when site `site_config.json` sets `bridge_closeout_secret`.  
   - Same secret for all bridge webhooks.

Implementation reference: `dewey_time/attendance_engine/bridge_auth.py`.

---

## 5. Timezone and `local_date`

- **`local_date`** must match how Frappe assigns checkins to a calendar day (company default timezone on the site).
- Use the **same rule** for sync watermarks and closeout.
- `last_device_log_at` / `last_delivered_at` are **local wall times** on that date (`YYYY-MM-DD HH:MM:SS`), not UTC offsets unless the site explicitly standardizes on UTC (confirm with ops).

Misaligned `local_date` causes watermarks and punches to appear on the wrong day in `/hr-attendance`.

---

## 6. Branch and device registry (Supabase)

- **`devices.location`** in Supabase = canonical Frappe **`Branch.name`**.
- Set on dashboard; bridge reads and copies to `custom_device_branch` and `device_branch` on webhooks.
- HR does **not** maintain a device registry in Frappe.

---

## 7. How Frappe / UI will consume sync data

After Frappe implements calendar API changes:

- `get_employee_calendar` returns **`device_sync[]`** for the employee’s **primary branch** (same filter idea as `device_alerts`).
- Open session band on **today**:
  - **Solid green** ends at aggregated **`min(last_delivered_at)`** across relevant devices (branch + devices seen in today’s checkins).
  - **Dashed amber** from sync horizon → now when `last_device_log_at > last_delivered_at` or heartbeat stale.
- If **`device_sync[]` is empty**, UI uses Phase 1 copy only: “On site · since {last punch}” — no real-time guarantee.

**Phase 1 UI** does not require bridge changes. **Phase 2** requires sync webhook.

---

## 8. Closeout vs sync — do not conflate

| Concern | Webhook | Frappe DocType | When |
|---------|---------|----------------|------|
| Intraday freshness | `notify_device_sync_status` | `Device Sync Status` | Every poll / 1–5 min heartbeat |
| Day reconciled | `notify_device_closeout_status` | `Device Closeout Alert` | End of device day |
| Failed deliveries at close | `undelivered[]` on `closed` | `Attendance Flag` `DELIVERY_FAILED` | Closeout only |

---

## 9. Error handling and retries

| Scenario | Bridge behavior |
|----------|-----------------|
| Frappe checkin POST fails | Retry with same `custom_supabase_log_id`; do not advance `last_delivered_at` past failed log |
| Sync webhook POST fails | Retry with backoff; **do not block** punch delivery |
| Partial batch delivery | `last_delivered_at` = max of **successful** inserts only; `pending_count` > 0 |
| Device unreachable | `last_error` set; `last_delivered_at` unchanged until delivery resumes |

---

## 10. Testing checklist (bridge)

- [ ] Single punch: checkin in Frappe → sync POST with equal `last_device_log_at` and `last_delivered_at`
- [ ] Two punches, second delayed: lag visible (`last_device_log_at` > `last_delivered_at`, `pending_count >= 1`)
- [ ] Idempotent checkin retry: no duplicate rows; `last_delivered_at` does not skip backward
- [ ] Heartbeat with zero new logs: POST accepted, timestamps stable
- [ ] Wrong `device_branch`: Frappe accepts but HR calendar may not show sync for employee — use correct Branch.name
- [ ] Closeout `closed` with `undelivered[]`: `DELIVERY_FAILED` path still works independently of sync
- [ ] Auth failure without secret / wrong secret returns 401
- [ ] `local_date` boundary at midnight: new sync row for new date

---

## 11. Optional enhancements (not blocking MVP)

- `last_poll_at` — bridge wall-clock time of last successful device poll
- `frappe_checkin_count` — count of checkins delivered for device+date (debug)
- Per-device health enum: `online` | `offline` | `degraded`

---

## 12. Frappe-side work (dewey_time repo — status Jun 2026)

| Item | Status |
|------|--------|
| DocType `Device Sync Status` | **In repo** — run `bench migrate` on site |
| `notify_device_sync_status` webhook | **In repo** — upsert + duplicate merge; validates branch + watermark order |
| `device_sync[]` in `get_employee_calendar` | **In repo** — one row per `(device_sn, local_date)` (latest `modified`) |
| Unique `(device_sn, local_date)` | **In repo** — DocType index + `validate` |
| HR timeline open-session + sync cap | **In repo** — built `hr_attendance` assets |

**Site deploy:** `bench migrate` then rebuild/pull app. Bridge can POST immediately after migrate.

**One-off duplicate cleanup** (e.g. three rows for `PYA8254100003` / `2026-06-03`):

```python
from dewey_time.attendance_engine.device_sync import merge_device_sync_duplicates
merge_device_sync_duplicates("PYA8254100003", "2026-06-03")
```

**Verify:** List `Device Sync Status` with `device_sn = PYA8254100003`, `local_date = 2026-06-03` → **1 row**. Bridge Supabase `device_frappe_sync_notify` for same keys → **1 row**, `frappe_sync_status` usually `success` after HTTP 200.

**Related files:**

- `dewey_time/attendance_engine/device_sync.py`
- `dewey_time/doctype/device_sync_status/`
- `dewey_time/attendance_engine/hr_calendar.py`
- `dewey_time/attendance_engine/closeout.py` (EOD closeout — unchanged)

**Not bridge work (Frappe P0, already in repo unless site is stale):**

- Range-aware `_get_shift_assignment` (`shift_assignment.py`) — used by calendar + closeout
- Dev toolbar `run_engine_for_employee` — see `docs/FRAPPE_DEV_RUN_ENGINE_PLAN.md` if present

---

## 13. Quick reference — endpoints

| Purpose | Frappe method |
|---------|----------------|
| Insert punch | Resource API `Employee Checkin` |
| Intraday sync | `dewey_time.attendance_engine.device_sync.notify_device_sync_status` |
| EOD closeout | `dewey_time.attendance_engine.closeout.notify_device_closeout_status` |

**Site config:** `bridge_closeout_secret` (optional) in `site_config.json`.

---

## 14. Related documentation

- [`FRAPPE_CUSTOM_APP_AGENT_GUIDE.md`](../FRAPPE_CUSTOM_APP_AGENT_GUIDE.md) — Frappe domain model + checkin fields
- [`FRAPPE_ATTENDANCE_RULES.md`](FRAPPE_ATTENDANCE_RULES.md) — flag and segment policy
- [`FLAG_ENGINE_MVP.md`](../FLAG_ENGINE_MVP.md) — pilot scope, `DELIVERY_FAILED`, closeout P0
- [`dewey_time/docs/CALENDAR_DATA_CONTRACT.md`](../dewey_time/docs/CALENDAR_DATA_CONTRACT.md) — calendar API shapes (`device_sync[]` to be added)

---

*Last updated: 2026-06-03 — intraday open session + Device Sync Status plan.*

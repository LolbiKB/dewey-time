# Schedule Import — Haiku Normalisation Prompt

Use this prompt in a Claude session (claude.ai or API) to convert any raw
schedule spreadsheet into the canonical import format. Run it once per new
spreadsheet layout, save the output as a CSV, then upload via **Weekly
Schedule → Import**.

---

## The Prompt

Copy the block below, paste your spreadsheet data after "SPREADSHEET:", then
send to Claude.

---

```
Convert the schedule spreadsheet below into a CSV with exactly these 7 columns:

employee_id, email, am_from, am_to, pm_from, pm_to, days_off

Rules:
1. Times → HH:MM 24-hour format only. Examples:
   7:30am  → 07:30
   12:00pm → 12:00
   1:00pm  → 13:00
   5:00pm  → 17:00
   6:30am  → 06:30

2. pm_from / pm_to → write "off" if the employee has no afternoon shift.

3. days_off → pipe-separated list of weekday names the employee does NOT work.
   Append "(am)" to a day if the employee works that morning but not the afternoon.
   Use full weekday names: Monday Tuesday Wednesday Thursday Friday Saturday Sunday

   Examples:
     Works Mon–Fri full day, off Sat+Sun:
       days_off = Saturday|Sunday

     Works Mon–Fri full day + Sat morning only, off Sun:
       days_off = Saturday(am)|Sunday

     Works Mon–Fri mornings only, off Sat+Sun:
       pm_from = off   (already captured in column 5)
       days_off = Saturday|Sunday

4. Include a header row.
5. Output raw CSV only — no explanation, no markdown fences.

SPREADSHEET:
[paste your data here]
```

---

## Expected output

```csv
employee_id,email,am_from,am_to,pm_from,pm_to,days_off
DI-0159,boeurnraksmey@diu.edu.kh,07:30,12:00,13:00,17:00,Saturday(am)|Sunday
DI-0969,long.udomkanha@diu.edu.kh,07:00,11:00,13:00,17:00,Saturday(am)|Sunday
DI-1201,jessa.gaspar@diu.edu.kh,07:00,11:00,off,off,Saturday|Sunday
DI-0614,donnah.rose.canonoy@diu.edu.kh,07:00,11:30,off,off,Saturday|Sunday
DI-0744,moeuk.maly@diu.edu.kh,07:00,11:30,13:00,17:00,Saturday|Sunday
DI-0364,chhorm.sophal@diu.edu.kh,06:30,11:30,12:30,17:00,Saturday(am)|Sunday
```

---

## Canonical format reference

| Column | Required | Notes |
|---|---|---|
| `employee_id` | ✓ | Badge/card number exactly as stored in Frappe (e.g. `DI-0159`) |
| `email` | optional | Used as fallback employee lookup if ID doesn't match |
| `am_from` | ✓ | Morning start — `HH:MM` 24h |
| `am_to` | ✓ | Morning end — `HH:MM` 24h |
| `pm_from` | ✓ | Afternoon start — `HH:MM` 24h, or `off` |
| `pm_to` | ✓ | Afternoon end — `HH:MM` 24h, or `off` |
| `days_off` | ✓ | Pipe-separated weekday names; append `(am)` for morning-only days |
| `employee_name` | optional | Column 8 — enables name matching when ID and email are missing |
| `monday`…`sunday` | optional | Columns 9–15 — per-day schedule (see below) |

### Per-day columns (teachers with different hours each day)

If **any** of `monday`…`sunday` is non-empty, the row switches to per-day
mode: the day columns are authoritative and `am_*`/`pm_*`/`days_off` are
ignored.

| Cell value | Meaning |
|---|---|
| `07:00-11:00` | Single block (no lunch) |
| `07:00-11:00+13:00-17:00` | AM + PM blocks; the gap between them is lunch |
| `off` or empty | Not working that day |

Maximum 2 blocks per day. Times `HH:MM` 24-hour.

### Name matching

When `employee_id` and `email` are both blank but `employee_name` is filled,
the importer matches the name against active Frappe employees (case and
word-order insensitive). A unique match imports with a `MATCHED_BY_NAME`
warning; multiple matches give `NAME_AMBIGUOUS`. A wrong `employee_id` is
never silently overridden by a name match.

### days_off quick reference

| Situation | days_off value |
|---|---|
| Off Sat + Sun | `Saturday\|Sunday` |
| Off Sun, Sat morning only | `Saturday(am)\|Sunday` |
| Off Sat + Sun (AM-only employee) | `Saturday\|Sunday` |
| Off Fri + Sat + Sun | `Friday\|Saturday\|Sunday` |
| Never off (7 days) | *(leave blank)* |

---

## Tips

- If your spreadsheet has a different employee ID format, ask Haiku to keep the
  original value unchanged.
- If a column is missing entirely (e.g. no email), tell Haiku to leave that
  column blank.
- Run the normalised CSV through the importer's preview before applying — any
  employee IDs that don't match Frappe will show as "Not found" so you can
  correct them before committing.
- After import preview, use **Download AI feedback** to export a CSV of every
  validation issue with machine-readable `code` and `suggestion` columns. Re-feed
  that file (or a summary) to the Haiku agent to fix remaining rows.

---

## Validation issue codes (importer feedback)

The importer assigns each problem a `code` you can filter on and export for the
AI normaliser. Fix **error** rows before import; **warning** rows may still
import if the employee matches Frappe.

| Code | Severity | Meaning | AI fix hint |
|---|---|---|---|
| `MISSING_EMPLOYEE_ID` | error | Blank first column | Always output badge ID (e.g. `DI-0159`) |
| `INVALID_EMPLOYEE_ID` | error | Not `XX-1234` format | Never put dates, times, or emails in employee_id |
| `EMPLOYEE_NOT_FOUND` | error | ID not in Frappe | Verify badge against HR master |
| `INVALID_TIME_FORMAT` | error | Not `HH:MM` 24h | Normalise `7:30am` → `07:30`; no seconds |
| `MISSING_SHIFT_TIMES` | error | No complete AM/PM/continuous window | See shapes below |
| `END_BEFORE_START` | error | End time ≤ start | Check am_to / pm_from / pm_to order |
| `NO_WORKING_DAYS` | error | All weekdays in days_off | Employee would never work |
| `GARBAGE_ROW` | error | Row looks like failed normalisation | Drop or re-normalise source row |
| `INELIGIBLE_EMPLOYMENT_TYPE` | error | Not Full-time / Part-time Fixed / Probation / Intern | Same gate as Weekly Schedule wizard — fix in Employee master or exclude row |
| `ACTIVE_SSA_EXISTS` | error | Employee already has active SSA | Clear schedule (dev) or disable SSAs in Desk first |
| `INVALID_WEEK_PATTERN` | error | Shift/lunch times invalid on a weekday | Fix times to match Weekly Schedule validation |
| `MIDNIGHT_AS_NOON` | warning | `00:00` in am_to or pm_from | Use `12:00` for noon lunch end |
| `INVALID_EMAIL` | warning | Malformed email column | Single address; no commas in field |
| `INVALID_DAYS_OFF_TOKEN` | warning | Unrecognised weekday token | Full names: `Saturday`, not `Sat` |
| `DUPLICATE_EMPLOYEE_ID` | warning | Same ID on multiple rows | One row per employee |
| `SHORT_LUNCH_GAP` | warning | Lunch gap under 15 minutes | Check am_to vs pm_from |
| `MATCHED_BY_NAME` | warning | Matched via employee_name only | Add employee_id for future imports |
| `NAME_AMBIGUOUS` | error | Name matches several employees | Add employee_id or email |
| `INVALID_DAY_SPEC` | error | Bad per-day cell format | Use `HH:MM-HH:MM[+HH:MM-HH:MM]` or `off` |
| `PM_ONLY` | info | `off,off,13:00,17:00` | Valid afternoon-only pattern |
| `CONTINUOUS_SHIFT` | info | `06:00,off,off,18:00` | Valid long day without lunch |
| `AM_ONLY` | info | `07:00,11:30,off,off` | Valid morning-only pattern |
| `PER_DAY` | info | Row uses per-day columns | Valid per-weekday pattern |

### Supported schedule shapes

| Shape | am_from | am_to | pm_from | pm_to | Example |
|---|---|---|---|---|---|
| Full day + lunch | time | time | time | time | `07:00,11:00,13:00,17:00` |
| AM only | time | time | off | off | `07:00,11:30,off,off` |
| PM only | off | off | time | time | `off,off,14:00,17:00` |
| Continuous (no lunch) | time | off | off | time | `06:00,off,off,18:00` |

### Common AI normalisation mistakes (from real imports)

1. **Empty employee_id** — email or date ends up in column 1; always copy badge ID.
2. **`00:00` for noon** — lunch end should be `12:00`, not midnight.
3. **Garbage trailing rows** — dates (`2017-03-03`), durations (`4h`), or times in the ID column.
4. **Comma in email** — CSV-escape emails with commas: `"name@domain.tld"`.
5. **PM-only staff** — set `am_from,am_to` to `off,off`, not blank.
6. **Long shifts** — use continuous shape when there is no lunch break.

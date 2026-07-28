export const DAY_ABBREV: Record<string, string> = {
  Monday: "M",
  Tuesday: "T",
  Wednesday: "W",
  Thursday: "Th",
  Friday: "F",
  Saturday: "S",
  Sunday: "Su",
};

export const SHAPE_LABELS: Record<string, string> = {
  full_day: "Full day",
  am_only: "AM only",
  pm_only: "PM only",
  continuous: "Continuous",
  per_day: "Per-day",
  invalid: "Invalid",
};

export const ISSUE_CODE_LABELS: Record<string, string> = {
  MISSING_EMPLOYEE_ID: "Missing ID",
  INVALID_EMPLOYEE_ID: "Bad ID format",
  EMPLOYEE_NOT_FOUND: "Not in Frappe",
  INVALID_TIME_FORMAT: "Bad time",
  MISSING_SHIFT_TIMES: "Missing times",
  END_BEFORE_START: "Time order",
  NO_WORKING_DAYS: "All days off",
  GARBAGE_ROW: "Garbage row",
  MIDNIGHT_AS_NOON: "00:00 → noon?",
  INVALID_EMAIL: "Bad email",
  INVALID_DAYS_OFF_TOKEN: "Bad days_off",
  DUPLICATE_EMPLOYEE_ID: "Duplicate ID",
  SHORT_LUNCH_GAP: "Short lunch",
  PM_ONLY: "PM only",
  CONTINUOUS_SHIFT: "Continuous",
  AM_ONLY: "AM only",
  INELIGIBLE_EMPLOYMENT_TYPE: "Employment type",
  EMPLOYMENT_TYPE_DERIVED: "Type derived",
  ACTIVE_SSA_EXISTS: "Active SSA",
  INVALID_WEEK_PATTERN: "Pattern invalid",
  PER_DAY: "Per-day",
  MATCHED_BY_NAME: "Name match",
  NAME_AMBIGUOUS: "Name ambiguous",
  INVALID_DAY_SPEC: "Bad day spec",
};

/** Canonical 7-column header the importer expects (also the template download). */
export const CANONICAL_HEADER =
  "employee_id,email,am_from,am_to,pm_from,pm_to,days_off";

export const CANONICAL_TEMPLATE = `${CANONICAL_HEADER}
DI-0001,jane@example.com,07:30,12:00,13:00,17:00,Saturday|Sunday
DI-0002,ray@example.com,07:00,11:00,off,off,Saturday(am)|Sunday
`;

/**
 * Canonical Haiku normalisation prompt — kept in sync with
 * docs/SCHEDULE_IMPORT_PROMPT.md. Paste raw spreadsheet data after "SPREADSHEET:".
 */
export const NORMALISATION_PROMPT = `Convert the schedule spreadsheet below into a CSV with exactly these 7 columns:

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
[paste your data here]`;

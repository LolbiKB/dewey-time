/**
 * The Mini App's words, in English and Khmer.
 *
 * A table rather than an i18n framework, deliberately. This surface is three
 * tabs and about thirty strings; a framework would add a build step, a loader
 * and a lazy-loading failure mode to a bundle that ships to phones on a
 * factory floor, and buy nothing this table does not already give.
 *
 * TRANSLATIONS NEED A NATIVE SPEAKER'S REVIEW BEFORE THEY REACH EMPLOYEES.
 * They are written to be literal and unambiguous rather than idiomatic, and
 * attendance wording is exactly where a near-miss does damage: "អវត្តមាន"
 * (absent) instead of "មិនមានកំណត់ត្រា" (no record) would have this app
 * accusing people of something HR has not decided. Every state here is
 * phrased as a RECORD, never as a judgement, and that property has to survive
 * review.
 *
 * Exhaustive by type: a key added to `en` and forgotten in `km` is a compile
 * error, not a screen that silently falls back to English for one label.
 */
export type Locale = "en" | "km";

export type StringKey = keyof typeof EN;

const EN = {
  // Tabs
  tabToday: "Today",

  // Day states — records, never judgements. See the note above.
  //
  // No `stateWorked`: the Day tab's summary block is gone (MyDayPage's own
  // note says why) and the Week row shows a worked day as its punch range,
  // never as the word. The other five are still reached, by a day that has no
  // range to show.
  stateDayOff: "Day off",
  stateOnLeave: "On leave",
  stateHoliday: "Holiday",
  stateScheduled: "Scheduled",
  stateNoPunches: "No punches recorded",

  // Roster labels. `labelIn`/`labelOut`/`labelWorked`/`lunchNotCounted`/
  // `summary` went with the Day summary — restoring that block means
  // restoring them too, in the same revert.
  labelRostered: "Rostered",
  labelLunch: "Lunch",

  // Where you are in the day, right now. Present tense, and RECORDS rather
  // than verdicts — see miniStatus.ts. "Out during shift" is the clock's
  // observation that the rostered window is still open, never a judgement
  // about why; the engine's own verdict is provisional until HR reviews it.
  statusNotIn: "Not checked in",
  statusIn: "In",
  statusLunch: "On lunch",
  statusOutDuringShift: "Out during shift",
  statusOut: "Checked out",

  // Duration units. Letters in English, words in Khmer — see
  // miniIntl.formatWorkedMinutes for why the spacing differs too.
  unitHour: "h",
  unitMinute: "m",

  // Week / schedule
  thisWeek: "This week",
  previousWeek: "Previous week",
  nextWeek: "Next week",
  backToThisWeek: "Back to this week",
  rosteredThisWeek: "Rostered this week, net of lunch",
  noShiftsThisWeek: "No shifts are assigned to you this week.",

  // Calendar sheet. The four marks are ACCESSIBLE TEXT, not decoration: the
  // grid is otherwise a field of identical circles to a screen reader, and the
  // marks are the reason the grid exists. Each says what the RECORD is, never
  // what the day was worth.
  chooseDate: "Choose a date",
  // The month arrows' accessible names, and the grid's own. react-day-picker
  // supplies all three itself — "Go to the Previous Month" — as bare English
  // literals with no locale behind them (a date-fns locale carries no labels),
  // so the two controls that page a Khmer month grid announced in English.
  // Lowercase-matched by the e2e paging test's locator; renaming them breaks a
  // bounds test whose easiest wrong repair is to loosen the locator.
  previousMonth: "Previous month",
  nextMonth: "Next month",
  // The <nav> the two arrows sit in. Its default is "Navigation bar" — found
  // by the sweep below, not by the audit, which is the argument for sweeping
  // rather than listing.
  monthNavigation: "Month navigation",
  workedInMonth: "Worked this month, net of lunch",
  markComplete: "complete record",
  // CLAIMS ABOUT A PUNCH, NEVER ABOUT THE DAY. "No clock-out recorded" was
  // the old wording and it was false on the commonest deficient day — IN,
  // OUT, IN has a recorded clock-out at midday; only the SECOND clock-in
  // lacks one. A stray punch can even be a duplicate of an end that exists.
  // So each label states what is true of the unmatched punch itself, and the
  // direction comes from that punch's own label alone.
  markIncomplete: "a clock-in without its pair",
  markIncompleteNoIn: "a clock-out without its pair",
  // Unlabelled or mixed strays: direction is not honestly callable, so the
  // mark refuses to name an end — the same refusal the Telegram receipt
  // makes.
  markUnpaired: "a punch without its pair",
  markMissing: "no record",
  markOff: "not a working day",

  // Day flags. The engine's findings, in the second person, as RECORDS rather
  // than verdicts — the same rule the day states above follow.
  //
  // No numbers anywhere: `evidence` is never sent to this app (grace minutes
  // are HR-only), so there is no duration here that could be trusted against
  // what HR sees. The timeline directly behind the sheet draws the times.
  flagsToCheck: "{n} to check",
  flagsSheetTitle: "Things to check",
  flagsNone: "Nothing to check on this day.",

  // The day's two figures, under the timeline. `daySoFar` marks a total that
  // is still moving, so a number below the roster does not read as a
  // shortfall on somebody who is only halfway through the day.
  daySoFar: "so far",
  // Read aloud, "8h 11m / 8h" is two durations and a slash. These are what a
  // screen reader announces instead; the visible row stays compact.
  //
  // Three whole sentences rather than one composed from fragments: gluing
  // "Worked" to a duration to a preposition fixes English word order onto
  // Khmer, and the translator cannot fix it from inside a fragment.
  dayAriaWorkedOfRostered: "Worked {worked} of {rostered} rostered",
  dayAriaWorkedOnly: "Worked {worked}",
  dayAriaRosteredOnly: "Rostered {rostered}, nothing worked yet",
  // AN EM DASH IS NOT A ZERO. A day whose punches never paired — a clock-in
  // nobody closed, two arrivals in a row, a punch from a device with no branch
  // mapped — has no total to give, and the visible row prints "—" to say
  // exactly that. Spoken as "nothing worked yet" it became a claim about the
  // PERSON on a day they were plainly there. These two say whose gap it is:
  // the figure's, not theirs.
  dayAriaRosteredNoTotal: "Rostered {rostered}, and the hours worked could not be added up",
  dayAriaNoTotal: "The hours worked could not be added up",

  flagLateStart: "Late start",
  flagLateStartBody: "Your first check-in was after your shift started.",
  flagLeftEarly: "Left early",
  flagLeftEarlyBody: "Your last check-out was before your shift ended.",
  flagLateFromLunch: "Late back from lunch",
  flagLateFromLunchBody: "You checked back in after your lunch break ended.",
  flagMissingTime: "Gap in your record",
  flagMissingTimeBody: "There's a stretch of your shift with no check-in covering it.",
  flagMissingInOrOut: "Only one check-in",
  flagMissingInOrOutBody:
    "Only one check-in was recorded, so there's no start-and-finish pair.",
  // UNNOTIFIED_ABSENCE maps here. "Unnotified absence" is a verdict word and
  // this app has no standing to use it; "no record" is what the data says, and
  // HR can still forgive it.
  flagNoRecord: "No record for this day",
  flagNoRecordBody: "This was a working day and no check-ins were recorded.",
  flagOffShiftPunch: "Checked in on a non-working day",
  flagOffShiftPunchBody:
    "Check-ins were recorded on a day you weren't scheduled to work.",
  flagMissingLunch: "Lunch not recorded",
  flagMissingLunchBody:
    "Your lunch break couldn't be matched to a check-out and check-in pair.",
  flagAttendanceIssue: "Record couldn't be matched up",
  flagAttendanceIssueBody:
    "Your check-ins for this day couldn't be paired into complete sessions.",

  flagStatusAwaiting: "Awaiting HR review",
  flagStatusExcused: "Excused by HR",
  flagStatusUpheld: "Upheld by HR",
  flagStatusRereview:
    "Awaiting HR review again — this day changed after it was reviewed",

  // ── The screens shown when the app cannot run ──
  //
  // ALL THREE ARE RENDERED IN BOTH LANGUAGES, and that is a decision about
  // what is knowable rather than a translation shortcut. The language comes
  // from Telegram's SDK or from a remembered choice, and on exactly these
  // screens there may be neither: the SDK is the thing that failed to load,
  // or React threw before the provider mounted. #203 settled the same
  // question for the bot ("the only bilingual messages left are the ones that
  // can arrive BEFORE a choice can exist"); these are the app's version of
  // that category.
  //
  // "Your attendance record is not affected" carries both bodies. These
  // screens are read by people worried about being marked absent — the
  // biometric copy already makes that link explicit — so a broken screen with
  // no reassurance is read as a broken RECORD. None of these words may call
  // anything about the employee's data an error.
  sdkStalledTitle: "The app didn't finish loading",
  sdkStalledBody:
    "Check your connection and try again. Your attendance record is not affected.",
  crashTitle: "This screen could not be shown",
  crashBody:
    "Try again. If it keeps happening, tell HR — your attendance record is not affected.",
  actionRetry: "Try again",

  // Chrome
  yourRecord: "Your record",
  // The sheets' dismiss control. The design system renders one with a
  // hardcoded English `sr-only` "Close" and no prop to translate it, so both
  // bottom sheets are dismissed by a button that announces in English under
  // Khmer. See MiniSheetClose for the local replacement.
  closeSheet: "Close",
  openFromTelegram: "Open this from Telegram",
  openFromTelegramBody: "Your attendance is only available through the Dewey Time bot.",

  // States
  loadingDay: "Loading your day…",
  loadingSchedule: "Loading your schedule…",
  errorDay: "Couldn't load your day. Try again in a moment.",
  errorSchedule: "Couldn't load your schedule. Try again in a moment.",
  loadingProfile: "Loading your record…",
  errorProfile: "Couldn't load your record. Try again in a moment.",

  // ── Profile ──
  tabProfile: "Profile",

  sectionRecord: "Your record",
  sectionBiometric: "Fingerprint & face",
  sectionContact: "Contact HR has for you",
  sectionMonth: "{month} so far",
  sectionRoster: "Your roster",

  labelEmployeeId: "Employee ID",
  labelDepartment: "Department",
  labelEmployment: "Employment",
  labelJoined: "Joined",
  labelReportsTo: "Reports to",
  labelStatus: "Status",
  labelFingers: "Fingers",
  labelFace: "Face",
  labelDevicesAt: "Devices at",
  labelLastChecked: "Last checked",
  labelPhone: "Phone",
  labelEmail: "Email",

  // Enrolment. A statement about the DEVICES, never about the person: it is
  // the machines that do not know them, not the person who failed to do
  // something. "Not checked yet" is a third state on purpose — see
  // miniapp_api._biometric for why it is not folded into "Not set up".
  bioEnrolled: "Set up",
  bioNotEnrolled: "Not set up",
  bioUnknown: "Not checked yet",
  bioNotEnrolledBody:
    "The fingerprint devices don't know you yet. Ask HR to enrol you, or you'll be marked absent.",
  bioUnknownBody:
    "We haven't heard from the fingerprint devices yet, so we can't tell you either way.",
  bioRecorded: "{n} recorded",

  statDaysWorked: "days worked",
  statHours: "hours",
  statToCheck: "to check",

  contactReadOnly: "Wrong? Tell HR — this page can't change it.",

  unitYear: "y",
  unitMonth: "mo",

  // The ten device slots plus the fallback. finger_slots.py owns the FID→slug
  // mapping; these are only the words for the slugs, and miniProfile.test.ts
  // reads that Python to keep the two lists in step.
  fingerLeftLittle: "Left little",
  fingerLeftRing: "Left ring",
  fingerLeftMiddle: "Left middle",
  fingerLeftIndex: "Left index",
  fingerLeftThumb: "Left thumb",
  fingerRightThumb: "Right thumb",
  fingerRightIndex: "Right index",
  fingerRightMiddle: "Right middle",
  fingerRightRing: "Right ring",
  fingerRightLittle: "Right little",
  fingerOther: "Another finger",

  // The day timeline's own words. The canvas is shared with HR's week view,
  // which keeps its English defaults (ui/timelineIntl.ts); these are the Mini
  // App's, so the picture speaks the same language as the heading above it.
  // `labelLunch` and `stateHoliday` already exist and are reused rather than
  // duplicated.
  timelineAway: "Away",
  timelineObserved: "observed",
  timelineScheduled: "Scheduled",
  timelineMissingExpected: "Missing expected",
  timelineWeeklyOff: "Weekly off",
  timelineInTransit: "Punches may still be in transit",
  timelineRoguePunch: "Rogue punch",
  timelineUnpairedPunch: "Unpaired punch",
  timelineOffShiftPunch: "Off-shift punch",
  timelineLate: "Late",
  timelineSegment: "Segment",

  // The three states this app previously had no words for. Each says what the
  // RECORD is or what WE could not do — never what the employee did.
  //
  // sessionEndedTitle/Body: a revoked link, a never-linked account, or a
  // launch older than the 24h window. All three used to render "Couldn't load
  // your day. Try again in a moment.", which is false on every count: nothing
  // is loading, trying again cannot work, and it was retried every 60 seconds
  // on the employee's own mobile data.
  sessionEndedTitle: "This link is no longer active",
  sessionEndedBody: "Open the app again from your Dewey Time chat. If that does not work, ask HR for a new link.",

  // rosterNotPublished: past the roster's own horizon. "No shifts are assigned
  // to you this week" is a statement about the roster that reads as a
  // statement about the employee — people plan around not working.
  rosterNotPublished: "The roster for this week has not been published yet.",

  // feedUncertain: the device feed never delivered for this day. Without this,
  // a Bridge outage was pixel-identical to a no-show.
  feedUncertain: "No data came from the device for this day.",
  markUncertain: "no data from the device",
  loadingMonth: "Loading this month\u2026",
  errorMonth: "This month could not be loaded.",
} as const;

const KM: Record<StringKey, string> = {
  tabToday: "ថ្ងៃនេះ",

  stateDayOff: "ថ្ងៃឈប់",
  stateOnLeave: "ច្បាប់ឈប់សម្រាក",
  stateHoliday: "ថ្ងៃបុណ្យ",
  stateScheduled: "មានកាលវិភាគ",
  // "No record of entry/exit" -- NOT "absent". The distinction is the whole
  // point; see the module note.
  stateNoPunches: "មិនមានកំណត់ត្រាចូល-ចេញ",

  labelRostered: "តាមកាលវិភាគ",
  labelLunch: "ម៉ោងសម្រាក",

  statusNotIn: "មិនទាន់ចូល",
  statusIn: "កំពុងធ្វើការ",
  statusLunch: "កំពុងសម្រាក",
  // "Went out, within working hours" -- a statement about the clock, not
  // about the person. It must not drift toward "left early".
  statusOutDuringShift: "បានចេញ ក្នុងម៉ោងធ្វើការ",
  statusOut: "បានចេញ",

  unitHour: "ម៉ោង",
  unitMinute: "នាទី",

  thisWeek: "សប្តាហ៍នេះ",
  previousWeek: "សប្តាហ៍មុន",
  nextWeek: "សប្តាហ៍ក្រោយ",
  backToThisWeek: "ត្រឡប់ទៅសប្តាហ៍នេះ",
  rosteredThisWeek: "ម៉ោងតាមកាលវិភាគសប្តាហ៍នេះ (ដកម៉ោងសម្រាក)",
  noShiftsThisWeek: "សប្តាហ៍នេះ អ្នកមិនមានវេនការងារទេ។",

  chooseDate: "ជ្រើសរើសថ្ងៃ",
  // Corroborated against react-day-picker's own km locale, which words the
  // same two controls "ទៅខែមុន" / "ទៅខែក្រោយ". Not imported from there: it is
  // a transitive dependency this app does not declare, and every Khmer word an
  // employee reads belongs in this table where it can be reviewed.
  previousMonth: "ទៅខែមុន",
  nextMonth: "ទៅខែក្រោយ",
  monthNavigation: "ការរុករកខែ",
  workedInMonth: "ម៉ោងធ្វើការខែនេះ (ដកម៉ោងសម្រាក)",
  markComplete: "កំណត់ត្រាពេញលេញ",
  markIncomplete: "កំណត់ត្រាចូលមិនមានគូ",
  markIncompleteNoIn: "កំណត់ត្រាចេញមិនមានគូ",
  markUnpaired: "កំណត់ត្រាមិនមានគូ",
  markMissing: "មិនមានកំណត់ត្រា",
  markOff: "មិនមែនថ្ងៃធ្វើការ",

  flagsToCheck: "{n} ត្រូវពិនិត្យ",
  flagsSheetTitle: "អ្វីដែលត្រូវពិនិត្យ",
  flagsNone: "គ្មានអ្វីត្រូវពិនិត្យសម្រាប់ថ្ងៃនេះទេ។",

  // MACHINE-DRAFTED, awaiting a native speaker -- as with the ~50 already
  // queued. `daySoFar` must read as "up to now", never as "only": the whole
  // point of the word is that the figure is unfinished, not that it is small.
  daySoFar: "គិតត្រឹមពេលនេះ",
  dayAriaWorkedOfRostered: "ធ្វើការ {worked} ក្នុងចំណោម {rostered} តាមកាលវិភាគ",
  dayAriaWorkedOnly: "ធ្វើការ {worked}",
  dayAriaRosteredOnly: "តាមកាលវិភាគ {rostered} មិនទាន់មានម៉ោងធ្វើការ",
  // MACHINE-DRAFTED. Must read as "the total could not be worked out", never
  // as "your check-ins are wrong" — the point of both lines is that nobody is
  // being blamed for a figure the app could not compute.
  dayAriaRosteredNoTotal: "តាមកាលវិភាគ {rostered} ហើយម៉ោងធ្វើការមិនអាចបូកសរុបបានទេ",
  dayAriaNoTotal: "ម៉ោងធ្វើការមិនអាចបូកសរុបបានទេ",

  flagLateStart: "ចាប់ផ្តើមយឺត",
  flagLateStartBody: "ការស្កេនចូលដំបូងរបស់អ្នកគឺក្រោយពេលវេនចាប់ផ្តើម។",
  flagLeftEarly: "ចេញមុនម៉ោង",
  flagLeftEarlyBody: "ការស្កេនចេញចុងក្រោយរបស់អ្នកគឺមុនពេលវេនបញ្ចប់។",
  flagLateFromLunch: "ត្រឡប់ពីអាហារថ្ងៃត្រង់យឺត",
  flagLateFromLunchBody: "អ្នកបានស្កេនចូលវិញក្រោយពេលសម្រាកអាហារថ្ងៃត្រង់បានបញ្ចប់។",
  flagMissingTime: "មានចន្លោះក្នុងកំណត់ត្រា",
  flagMissingTimeBody: "មានរយៈពេលមួយក្នុងវេនរបស់អ្នកដែលគ្មានការស្កេនគ្របដណ្តប់។",
  flagMissingInOrOut: "មានតែការស្កេនម្តង",
  flagMissingInOrOutBody:
    "មានតែការស្កេនមួយប៉ុណ្ណោះត្រូវបានកត់ត្រា ដូច្នេះគ្មានគូចូល និងចេញទេ។",
  // "No record for this day" — never "អវត្តមាន" (absent). The same rule
  // markMissing follows: the app reports the record, HR decides what it means.
  flagNoRecord: "គ្មានកំណត់ត្រាសម្រាប់ថ្ងៃនេះ",
  flagNoRecordBody: "នេះជាថ្ងៃធ្វើការ ហើយគ្មានការស្កេនណាមួយត្រូវបានកត់ត្រាទេ។",
  flagOffShiftPunch: "ស្កេនក្នុងថ្ងៃមិនធ្វើការ",
  flagOffShiftPunchBody: "មានការស្កេនត្រូវបានកត់ត្រាក្នុងថ្ងៃដែលអ្នកមិនមានវេនធ្វើការ។",
  flagMissingLunch: "មិនមានកំណត់ត្រាអាហារថ្ងៃត្រង់",
  flagMissingLunchBody:
    "ការសម្រាកអាហារថ្ងៃត្រង់របស់អ្នកមិនអាចផ្គូផ្គងនឹងការស្កេនចេញ និងចូលបានទេ។",
  flagAttendanceIssue: "កំណត់ត្រាមិនអាចផ្គូផ្គងបាន",
  flagAttendanceIssueBody:
    "ការស្កេនរបស់អ្នកសម្រាប់ថ្ងៃនេះមិនអាចផ្គូផ្គងជាវគ្គពេញលេញបានទេ។",

  flagStatusAwaiting: "រង់ចាំការពិនិត្យពី HR",
  flagStatusExcused: "បានអនុគ្រោះដោយ HR",
  // "HR confirmed this note" — NOT "HR punished you". The single string on
  // this surface most likely to be wrong; see the file header.
  flagStatusUpheld: "បានបញ្ជាក់ដោយ HR",
  flagStatusRereview: "រង់ចាំការពិនិត្យឡើងវិញ — ថ្ងៃនេះមានការផ្លាស់ប្តូរក្រោយពេលពិនិត្យ។",

  // MACHINE-DRAFTED. The reassurance clause — "កំណត់ត្រាវត្តមានរបស់អ្នកមិនរង
  // ផលប៉ះពាល់ទេ" — is the load-bearing half of both bodies and the half most
  // worth a native speaker's eye: it has to read as "nothing has happened to
  // your record", never as "your record is unaffected BY THE PROBLEM WE ARE
  // NOT TELLING YOU ABOUT".
  sdkStalledTitle: "កម្មវិធីមិនទាន់ផ្ទុករួចរាល់ទេ",
  sdkStalledBody:
    "សូមពិនិត្យអ៊ីនធឺណិតរបស់អ្នក រួចព្យាយាមម្តងទៀត។ កំណត់ត្រាវត្តមានរបស់អ្នកមិនរងផលប៉ះពាល់ទេ។",
  crashTitle: "អេក្រង់នេះមិនអាចបង្ហាញបានទេ",
  crashBody:
    "សូមព្យាយាមម្តងទៀត។ បើវានៅតែកើតឡើង សូមប្រាប់ HR — កំណត់ត្រាវត្តមានរបស់អ្នកមិនរងផលប៉ះពាល់ទេ។",
  actionRetry: "ព្យាយាមម្តងទៀត",

  yourRecord: "កំណត់ត្រារបស់អ្នក",
  closeSheet: "បិទ",
  openFromTelegram: "សូមបើកពី Telegram",
  openFromTelegramBody: "កំណត់ត្រាវត្តមានរបស់អ្នកអាចមើលបានតែតាម Dewey Time bot ប៉ុណ្ណោះ។",

  loadingDay: "កំពុងផ្ទុក…",
  loadingSchedule: "កំពុងផ្ទុក…",
  errorDay: "មិនអាចផ្ទុកបានទេ។ សូមព្យាយាមម្ដងទៀត។",
  errorSchedule: "មិនអាចផ្ទុកបានទេ។ សូមព្យាយាមម្ដងទៀត។",
  loadingProfile: "កំពុងផ្ទុកកំណត់ត្រារបស់អ្នក…",
  errorProfile: "មិនអាចផ្ទុកកំណត់ត្រារបស់អ្នកបានទេ។ សូមព្យាយាមម្ដងទៀត។",

  // ── Profile ──
  tabProfile: "ប្រវត្តិរូប",

  sectionRecord: "កំណត់ត្រារបស់អ្នក",
  sectionBiometric: "ស្នាមម្រាមដៃ និងមុខ",
  sectionContact: "ទំនាក់ទំនងដែល HR មាន",
  sectionMonth: "{month} រហូតមកដល់ពេលនេះ",
  sectionRoster: "កាលវិភាគរបស់អ្នក",

  labelEmployeeId: "លេខសម្គាល់បុគ្គលិក",
  labelDepartment: "ផ្នែក",
  labelEmployment: "ប្រភេទការងារ",
  labelJoined: "ចូលធ្វើការ",
  labelReportsTo: "ស្ថិតក្រោមការគ្រប់គ្រងរបស់",
  labelStatus: "ស្ថានភាព",
  labelFingers: "ម្រាមដៃ",
  labelFace: "មុខ",
  labelDevicesAt: "ម៉ាស៊ីននៅ",
  labelLastChecked: "ពិនិត្យចុងក្រោយ",
  labelPhone: "ទូរស័ព្ទ",
  labelEmail: "អ៊ីមែល",

  bioEnrolled: "បានចុះឈ្មោះ",
  bioNotEnrolled: "មិនទាន់បានចុះឈ្មោះ",
  bioUnknown: "មិនទាន់បានពិនិត្យ",
  bioNotEnrolledBody:
    "ម៉ាស៊ីនស្នាមម្រាមដៃមិនទាន់ស្គាល់អ្នកនៅឡើយទេ។ សូមប្រាប់ HR ឱ្យចុះឈ្មោះអ្នក បើមិនដូច្នេះទេ អ្នកនឹងត្រូវបានកត់ត្រាថាអវត្តមាន។",
  bioUnknownBody:
    "យើងមិនទាន់ទទួលបានព័ត៌មានពីម៉ាស៊ីនស្នាមម្រាមដៃនៅឡើយទេ ដូច្នេះយើងមិនអាចប្រាប់អ្នកបានទេ។",
  bioRecorded: "បានកត់ត្រា {n}",

  statDaysWorked: "ថ្ងៃធ្វើការ",
  statHours: "ម៉ោង",
  statToCheck: "ត្រូវពិនិត្យ",

  contactReadOnly: "ខុសមែនទេ? សូមប្រាប់ HR — ទំព័រនេះមិនអាចកែបានទេ។",

  unitYear: "ឆ្នាំ",
  unitMonth: "ខែ",

  fingerLeftLittle: "កូនដៃឆ្វេង",
  fingerLeftRing: "ម្រាមនាងឆ្វេង",
  fingerLeftMiddle: "ម្រាមកណ្តាលឆ្វេង",
  fingerLeftIndex: "ម្រាមចង្អុលឆ្វេង",
  fingerLeftThumb: "មេដៃឆ្វេង",
  fingerRightThumb: "មេដៃស្តាំ",
  fingerRightIndex: "ម្រាមចង្អុលស្តាំ",
  fingerRightMiddle: "ម្រាមកណ្តាលស្តាំ",
  fingerRightRing: "ម្រាមនាងស្តាំ",
  fingerRightLittle: "កូនដៃស្តាំ",
  fingerOther: "ម្រាមដៃផ្សេងទៀត",

  timelineAway: "ចេញក្រៅ",
  timelineObserved: "សង្កេតឃើញ",
  timelineScheduled: "តាមកាលវិភាគ",
  // "No record during working hours" -- NOT "missing work". The band marks a
  // gap in the RECORD, and the wording must not drift into an accusation.
  timelineMissingExpected: "គ្មានកំណត់ត្រាក្នុងម៉ោងធ្វើការ",
  timelineWeeklyOff: "ថ្ងៃឈប់ប្រចាំសប្តាហ៍",
  timelineInTransit: "កំណត់ត្រាអាចកំពុងបញ្ជូន",
  timelineRoguePunch: "ការស្កេនមិនស្គាល់ទីតាំង",
  timelineUnpairedPunch: "ការស្កេនគ្មានគូ",
  timelineOffShiftPunch: "ការស្កេនក្រៅម៉ោងធ្វើការ",
  timelineLate: "យឺត",
  timelineSegment: "ចន្លោះពេល",

  sessionEndedTitle: "តំណនេះលែងដំណើរការហើយ",
  sessionEndedBody: "សូមបើកកម្មវិធីម្តងទៀតពីការសន្ទនា Dewey Time របស់អ្នក។ បើនៅតែមិនបាន សូមសុំតំណថ្មីពីផ្នែកធនធានមនុស្ស។",

  rosterNotPublished: "កាលវិភាគសម្រាប់សប្តាហ៍នេះ មិនទាន់ត្រូវបានចេញផ្សាយនៅឡើយទេ។",

  // "No data came from the machine" -- about our equipment, not about them.
  feedUncertain: "គ្មានទិន្នន័យមកពីម៉ាស៊ីនសម្រាប់ថ្ងៃនេះទេ។",
  markUncertain: "គ្មានទិន្នន័យពីម៉ាស៊ីន",
  loadingMonth: "កំពុងផ្ទុកខែនេះ…",
  errorMonth: "មិនអាចផ្ទុកខែនេះបានទេ។",

};

const TABLES: Record<Locale, Record<StringKey, string>> = { en: EN, km: KM };

/** A lookup bound to one locale. */
/**
 * One string in both languages, for the screens that render before a language
 * can be known.
 *
 * There are exactly three: the two failure notices and the crash screen. Each
 * of them is reachable in a state where the usual answer does not exist — the
 * SDK that reports the reader's language is the thing that did not load, or
 * React threw before `MiniLocaleProvider` mounted — and defaulting to English
 * there hands an unreadable screen to the people least able to report it.
 *
 * Khmer first, deliberately: it is the roster's language, and on a screen
 * showing both, the first line is the one that gets read.
 */
export function inBothLanguages(key: StringKey): { km: string; en: string } {
  return { km: KM[key], en: EN[key] };
}

export type Translate = (key: StringKey) => string;

export function translator(locale: Locale): Translate {
  const table = TABLES[locale] ?? EN;
  // Falls back to English per key rather than per table: a string that somehow
  // arrives empty should show SOMETHING, and a blank label is indistinguishable
  // from a layout bug.
  return (key) => table[key] || EN[key];
}

/**
 * Which language to open in.
 *
 * Telegram's `language_code` is the client's own setting and comes from
 * `initDataUnsafe` — untrusted, and correctly so: nothing is authorised by it,
 * it only decides which column of a table is read. A saved preference wins,
 * because someone who has chosen once has said something more specific than
 * their phone's locale.
 *
 * Anything that is not Khmer opens in English. Guessing Khmer from a region or
 * a timezone would put an unreadable interface in front of the people least
 * able to report it.
 */
export function resolveLocale(saved: string | null, languageCode: string | undefined): Locale {
  if (saved === "en" || saved === "km") return saved;
  return (languageCode || "").toLowerCase().startsWith("km") ? "km" : "en";
}

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "km";
}

/** The other one, for a two-way toggle. */
export function otherLocale(locale: Locale): Locale {
  return locale === "km" ? "en" : "km";
}

/** How the toggle labels itself: always in the language it switches TO. */
export const LOCALE_LABEL: Record<Locale, string> = { en: "English", km: "ភាសាខ្មែរ" };

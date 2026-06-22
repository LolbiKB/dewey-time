type Severity = "INFO" | "WARNING" | "CRITICAL"
type FlagStatus = "OPEN" | "EXPLAINED" | "APPROVED" | "REJECTED" | "CLOSED"

type ShiftContext = {
  shift_assigned: boolean
  shift_type?: string
  start_time?: string
  end_time?: string
  grace_minutes?: number
  lunch_start?: string | null
  lunch_end?: string | null
}

type Checkin = {
  time: string
  log_type?: "IN" | "OUT" | null
  device_id?: string | null
  custom_device_branch?: string | null
}

type Flag = {
  name: string
  flag_code: string
  severity?: Severity
  status?: FlagStatus
  source?: "AUTO" | "EMPLOYEE" | "HR"
  day_closed?: 0 | 1
  rule_version?: string
  evidence?: unknown
}

export type Day = {
  date: string
  shift?: ShiftContext
  checkins?: Checkin[]
  first_in?: string | null
  last_out?: string | null
  gross_minutes?: number | null
  flags?: Flag[]
}

export type CalendarPayload = {
  employee: string
  start_date: string
  end_date: string
  days: Day[]
}

export const EMPLOYEES: Array<{
  id: string
  label: string
  image?: string | null
  title?: string | null
  department?: string | null
  company?: string | null
}> = [
  {
    id: "EMP-0001",
    label: "EMP-0001 · Demo Employee",
    image: "/assets/frappe/images/default-avatar.png",
    title: "Sales Associate",
    department: "Retail",
    company: "ZKTeco Demo",
  },
  {
    id: "EMP-0002",
    label: "EMP-0002 · A. Al-Sayed",
    image: "/assets/frappe/images/default-avatar.png",
    title: "HR Specialist",
    department: "HR",
    company: "ZKTeco Demo",
  },
  {
    id: "EMP-0003",
    label: "EMP-0003 · M. Reyes",
    image: "/assets/frappe/images/default-avatar.png",
    title: "Ops Supervisor",
    department: "Operations",
    company: "ZKTeco Demo",
  },
]

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFor(employee: string, date: string) {
  let h = 2166136261
  const s = `${employee}:${date}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function fmtDate(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

function weekdayIndex(y: number, m: number, d: number) {
  // 0=Sun ... 6=Sat (local)
  return new Date(y, m - 1, d).getDay()
}

function minutesToTime(min: number) {
  const hh = Math.floor(min / 60)
  const mm = min % 60
  return `${pad2(hh)}:${pad2(mm)}:00`
}

function minutesToDateTime(date: string, min: number) {
  const hh = Math.floor(min / 60)
  const mm = min % 60
  return `${date} ${pad2(hh)}:${pad2(mm)}:00`
}

function diffMinutes(a: string, b: string) {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null
  const delta = db - da
  if (delta < 0) return null
  return Math.round(delta / 60000)
}

function worstSeverity(flags: Flag[]) {
  let worst: Severity | null = null
  for (const f of flags) {
    const s = (f.severity ?? "WARNING") as Severity
    if (s === "CRITICAL") return "CRITICAL"
    if (s === "WARNING") worst = worst ?? "WARNING"
    if (s === "INFO" && worst == null) worst = "INFO"
  }
  return worst
}

function makeShift(date: string, wday: number, r: () => number): ShiftContext {
  // Shift Assignment only:
  // - Sun: unassigned
  // - Sat: short shift (no lunch)
  // - Mon-Fri: full-day shift with lunch
  if (wday === 0) return { shift_assigned: false }
  if (wday === 6) {
    return {
      shift_assigned: true,
      shift_type: "FT_0900_1300",
      start_time: "09:00:00",
      end_time: "13:00:00",
      grace_minutes: 0,
      lunch_start: null,
      lunch_end: null,
    }
  }

  const grace = r() < 0.35 ? 5 : 0
  return {
    shift_assigned: true,
    shift_type: "FT_0800_1700",
    start_time: "08:00:00",
    end_time: "17:00:00",
    grace_minutes: grace,
    lunch_start: "12:00:00",
    lunch_end: "13:00:00",
  }
}

function makeDay(employee: string, date: string, shift: ShiftContext, r: () => number): Day {
  const flags: Flag[] = []
  const checkins: Checkin[] = []

  const startMin = shift.shift_assigned && shift.start_time ? Number(shift.start_time.slice(0, 2)) * 60 + Number(shift.start_time.slice(3, 5)) : null
  const endMin = shift.shift_assigned && shift.end_time ? Number(shift.end_time.slice(0, 2)) * 60 + Number(shift.end_time.slice(3, 5)) : null
  const grace = shift.shift_assigned ? (shift.grace_minutes ?? 0) : 0

  // Branch patterns per employee
  const homeBranch = employee === "EMP-0001" ? "BRANCH-A" : employee === "EMP-0002" ? "BRANCH-B" : "BRANCH-C"
  const altBranch = employee === "EMP-0001" ? "BRANCH-C" : employee === "EMP-0002" ? "BRANCH-A" : "BRANCH-B"

  // Chance model
  const isAbsent = shift.shift_assigned && r() < 0.05
  const isMissing = shift.shift_assigned && !isAbsent && r() < 0.07
  const isOffShiftPunch = !shift.shift_assigned && r() < 0.18
  const isBranchMismatch = shift.shift_assigned && r() < 0.12
  const unknownBranch = r() < 0.04

  if (isAbsent) {
    flags.push({
      name: `AUTO-${employee}-${date}-UNNOTIFIED_ABSENCE`,
      flag_code: "UNNOTIFIED_ABSENCE",
      severity: "CRITICAL",
      source: "AUTO",
      status: "OPEN",
      day_closed: 1,
      rule_version: "v0",
      evidence: { expected_shift: shift.shift_type ?? null },
    })
    return { date, shift, checkins: [], first_in: null, last_out: null, gross_minutes: null, flags }
  }

  if (!shift.shift_assigned && !isOffShiftPunch) {
    return { date, shift, checkins: [], first_in: null, last_out: null, gross_minutes: null, flags: [] }
  }

  // Generate times
  const branch = unknownBranch ? null : isBranchMismatch ? altBranch : homeBranch
  const device = branch === "BRANCH-A" ? "DEV-01" : branch === "BRANCH-B" ? "DEV-02" : branch === "BRANCH-C" ? "DEV-03" : "DEV-99"

  if (!shift.shift_assigned) {
    // off-shift punch (simple)
    const inMin = 8 * 60 + Math.floor(r() * 30)
    const outMin = 16 * 60 + Math.floor(r() * 30)
    checkins.push({ time: minutesToDateTime(date, inMin), log_type: "IN", device_id: device, custom_device_branch: branch })
    checkins.push({ time: minutesToDateTime(date, outMin), log_type: "OUT", device_id: device, custom_device_branch: branch })
    flags.push({
      name: `AUTO-${employee}-${date}-OFF_SHIFT_PUNCH`,
      flag_code: "OFF_SHIFT_PUNCH",
      severity: "INFO",
      source: "AUTO",
      status: "OPEN",
      day_closed: 1,
      rule_version: "v0",
      evidence: { shift_assigned: false },
    })
  } else {
    const baseStart = startMin ?? 8 * 60
    const baseEnd = endMin ?? 17 * 60

    const lateBy = r() < 0.22 ? 5 + Math.floor(r() * 40) : Math.floor(r() * 4)
    const inMin = baseStart + lateBy
    const outMin = baseEnd - Math.floor(r() * 20)

    // Lunch only for full-day shifts
    const hasLunch = !!(shift.lunch_start && shift.lunch_end)
    const lunchStart = 12 * 60 + Math.floor(r() * 10)
    const lunchEnd = 13 * 60 + Math.floor(r() * 15)

    checkins.push({ time: minutesToDateTime(date, inMin), log_type: "IN", device_id: device, custom_device_branch: branch })

    if (hasLunch && r() < 0.88) {
      checkins.push({ time: minutesToDateTime(date, lunchStart), log_type: "OUT", device_id: device, custom_device_branch: branch })
      checkins.push({ time: minutesToDateTime(date, lunchEnd), log_type: "IN", device_id: device, custom_device_branch: branch })
    } else if (hasLunch) {
      flags.push({
        name: `AUTO-${employee}-${date}-MISSING_LUNCH`,
        flag_code: "MISSING_LUNCH",
        severity: "WARNING",
        source: "AUTO",
        status: "OPEN",
        day_closed: 1,
        rule_version: "v0",
        evidence: { expected_lunch: `${shift.lunch_start}–${shift.lunch_end}` },
      })
    }

    if (!isMissing) {
      checkins.push({ time: minutesToDateTime(date, outMin), log_type: "OUT", device_id: device, custom_device_branch: branch })
    } else {
      flags.push({
        name: `AUTO-${employee}-${date}-MISSING_IN_OR_OUT`,
        flag_code: "MISSING_IN_OR_OUT",
        severity: "CRITICAL",
        source: "AUTO",
        status: "OPEN",
        day_closed: 0,
        rule_version: "v0",
        evidence: { reason: "Only one punch present" },
      })
    }

    // Late start flag
    const threshold = baseStart + grace
    if (inMin > threshold) {
      flags.push({
        name: `AUTO-${employee}-${date}-LATE_START`,
        flag_code: "LATE_START",
        severity: "WARNING",
        source: "AUTO",
        status: "OPEN",
        day_closed: 1,
        rule_version: "v0",
        evidence: { threshold_minutes: threshold, first_in_minutes: inMin },
      })
    }

    // Branch mismatch flag
    if (branch && isBranchMismatch) {
      flags.push({
        name: `AUTO-${employee}-${date}-NON_PRIMARY_SITE_PUNCH`,
        flag_code: "NON_PRIMARY_SITE_PUNCH",
        severity: "WARNING",
        source: "AUTO",
        status: "OPEN",
        day_closed: 1,
        rule_version: "v0",
        evidence: { expected_branch: homeBranch, observed_branch: branch },
      })
    }

    // Unknown branch
    if (branch == null) {
      flags.push({
        name: `AUTO-${employee}-${date}-UNKNOWN_DEVICE_BRANCH`,
        flag_code: "UNKNOWN_DEVICE_BRANCH",
        severity: "INFO",
        source: "AUTO",
        status: "OPEN",
        day_closed: 1,
        rule_version: "v0",
        evidence: { device_id: device },
      })
    }
  }

  // Derive summary
  const sorted = [...checkins].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  const first = sorted[0]?.time ?? null
  const last = sorted.length ? sorted[sorted.length - 1].time : null
  const gross = first && last ? diffMinutes(first, last) : null

  // Calm OK: if no flags and there are segments, leave empty; UI will default OK to green
  return { date, shift, checkins: sorted, first_in: first, last_out: last, gross_minutes: gross, flags }
}

export function getMockMonth(employee: string, year = 2026, month = 5): CalendarPayload {
  const daysInMonth = new Date(year, month, 0).getDate()
  const days: Day[] = []

  for (let d = 1; d <= daysInMonth; d++) {
    const date = fmtDate(year, month, d)
    const r = mulberry32(seedFor(employee, date))
    const wday = weekdayIndex(year, month, d)
    const shift = makeShift(date, wday, r)
    days.push(makeDay(employee, date, shift, r))
  }

  return {
    employee,
    start_date: fmtDate(year, month, 1),
    end_date: fmtDate(year, month, daysInMonth),
    days,
  }
}


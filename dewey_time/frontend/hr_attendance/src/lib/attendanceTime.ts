import { format } from "date-fns";

import type { Day } from "@/types/calendar";

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function minutesSinceMidnight(d: Date) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return NaN;
  return d.getHours() * 60 + d.getMinutes();
}

export function parseDateTimeLocal(value: string) {
  const v = String(value || "").trim();
  if (!v) return new Date(NaN);
  const isoish = v.includes("T") ? v : v.replace(" ", "T");
  return new Date(isoish);
}

export function minutesFromDateTime(value: string | null | undefined) {
  if (!value) return null;
  const d = parseDateTimeLocal(value);
  const m = minutesSinceMidnight(d);
  return Number.isFinite(m) ? m : null;
}

export function formatDurationMinutes(
  totalMinutes: number | null | undefined,
  options?: { signed?: boolean }
): string {
  if (totalMinutes == null || !Number.isFinite(totalMinutes)) return "—";

  const rounded = Math.round(Math.abs(totalMinutes));
  const days = Math.floor(rounded / (24 * 60));
  const remainder = rounded % (24 * 60);
  const hours = Math.floor(remainder / 60);
  const minutes = remainder % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  const body = parts.join(" ");
  if (!options?.signed) return body;
  if (totalMinutes > 0) return `+${body}`;
  if (totalMinutes < 0) return `-${body}`;
  return body;
}

export function formatBranchLabel(branch: string | null | undefined) {
  if (!branch) return null;
  let label = branch.trim();
  label = label.replace(/^BRANCH-/i, "");
  label = label.replace(/^Branch\s+/i, "");
  return label || null;
}

export function formatCheckinTime(value: string | null | undefined) {
  if (!value) return "—";
  return format(parseDateTimeLocal(value), "h:mm a");
}

/** Parse yyyy-MM-dd as local noon (avoids UTC date-only timezone shifts). */
export function parseDateKey(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12, 0, 0, 0);
}

export function formatMinuteOnDay(dateKey: string, minutes: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const dt = new Date(y!, m! - 1, d!, hh, mm, 0, 0);
  return format(dt, "h:mm a");
}

/** First–last time label; only when there are at least two punches and they differ. */
export function formatDayCheckinTimeRange(day?: Day): string | null {
  const checkins = day?.checkins ?? [];
  if (checkins.length < 2 || !day?.first_in || !day?.last_out) return null;

  const first = parseDateTimeLocal(day.first_in);
  const last = parseDateTimeLocal(day.last_out);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())) return null;
  if (first.getTime() === last.getTime()) return null;

  return `${format(first, "h:mm a")} – ${format(last, "h:mm a")}`;
}

export function parseTimeToMinutes(time: string | undefined | null) {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

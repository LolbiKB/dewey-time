import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { FrappeCallError } from "@/lib/frappe";
import type { Day } from "@/types/calendar";
import type { Biometric } from "@/miniapp/miniProfile";
import { isAppActive, onActiveChange } from "@/miniapp/telegramChrome";

/** Sentinel for "this page is not running inside Telegram". */
export const MISSING_INIT_DATA = "";

/** The narrowed payload get_my_calendar returns. A structural subset of `Day`,
 *  which is why the HR timeline components render it unchanged.
 *
 *  The identity fields are nullable by contract, not by oversight: designation
 *  and branch are unset for a great many employees, and the Khmer pair is a
 *  custom field the backend reads behind a has_column check. */
export type MiniCalendar = {
  employee: string;
  employee_name?: string | null;
  khmer_name?: string | null;
  designation?: string | null;
  /** The Employee record's own photo, or null when there is none a Guest
   *  can load. Never the Telegram avatar. */
  image?: string | null;
  employee_branch?: string | null;
  /** Their own employment type, so a clock-based day stops rendering as an
   *  exception. See PAYLOAD_KEYS in telegram/miniapp_api.py. */
  is_clock_based?: boolean;
  /** How far the roster has actually been published — the bound on forward
   *  paging, and the difference between "no shifts" and "not built yet". */
  schedule_max_date?: string | null;
  days: Day[];
};

const CALENDAR_METHOD = "dewey_time.telegram.miniapp_api.get_my_calendar";
const PROFILE_METHOD = "dewey_time.telegram.miniapp_api.get_my_profile";

/**
 * A verdict the server will simply repeat.
 *
 * A revoked link, an account that was never linked, and a launch older than the
 * 24-hour window all arrive as 403. None of them can improve by asking again.
 */
export function isPermanentRejection(error: unknown): boolean {
  return error instanceof FrappeCallError && error.status >= 400 && error.status < 500;
}

/**
 * The viewer's Telegram avatar, if the client offered one.
 *
 * From `initDataUnsafe`, which is explicitly untrusted — and that is fine for
 * exactly this: it is decoration beside a name the SERVER supplied. Nothing is
 * decided by it. It is never used to identify anyone.
 */
/**
 * The client's own language setting.
 *
 * From `initDataUnsafe`, which is untrusted — and that is fine here: nothing
 * is authorised by it, it only picks which column of a string table is read.
 */
export function telegramLanguageCode(w: Window): string | undefined {
  return w?.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
}

export function telegramPhotoUrl(w: Window): string | null {
  const url = w?.Telegram?.WebApp?.initDataUnsafe?.user?.photo_url;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

/**
 * Only the SDK's copy of initData is trusted.
 *
 * Reading it from the URL or from postMessage would be attacker-controllable:
 * anyone could paste a captured launch into a browser and replay it. The
 * server re-verifies the HMAC regardless, so this is defence in depth rather
 * than the boundary — but there is no reason to hand it a value we know is
 * weaker.
 */
export function initDataFromTelegram(w: Window): string {
  return w?.Telegram?.WebApp?.initData || MISSING_INIT_DATA;
}

export function isInsideTelegram(): boolean {
  return initDataFromTelegram(window) !== MISSING_INIT_DATA;
}

async function fetchCalendar(
  initData: string,
  startDate: string,
  endDate: string,
): Promise<MiniCalendar> {
  const response = await fetch(
    "/api/method/dewey_time.telegram.miniapp_api.get_my_calendar",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": window.csrf_token ?? "",
      },
      body: JSON.stringify({
        init_data: initData,
        start_date: startDate,
        end_date: endDate,
      }),
    },
  );
  if (!response.ok) {
    // FrappeCallError, NOT a plain Error, and that is the whole fix. The shared
    // query client already refuses to retry 4xx (lib/queryClient.ts) — but it
    // discriminates on `err instanceof FrappeCallError`, so throwing a plain
    // Error meant the rule silently did not apply to this app at all. A revoked
    // link, a never-linked account and an expired launch were each requested
    // three times and then re-polled every 60 seconds forever, on the
    // employee's own mobile data, behind a message promising it would work in
    // a moment.
    throw new FrappeCallError(`calendar request failed: ${response.status}`, {
      status: response.status,
      method: CALENDAR_METHOD,
    });
  }
  return (await response.json()).message as MiniCalendar;
}

export function useMiniAppCalendar(
  startDate: string,
  endDate: string,
  /** `poll: false` for a caller that makes no claim about the present. Not part
   *  of the query key — the cache stays shared with every other caller of the
   *  same range, and only this observer's interval changes. */
  opts?: { poll?: boolean; enabled?: boolean },
) {
  const initData = initDataFromTelegram(window);
  const active = useIsAppActive();
  return useQuery({
    queryKey: ["mini-calendar", startDate, endDate],
    // Outside Telegram there is nothing to authenticate with, so the request
    // is never fired -- the shell shows an explanation instead of a 403.
    //
    // `enabled` also lets a caller that is MOUNTED BUT CLOSED opt out: the
    // calendar sheet lives in the shell whether or not it is open, and without
    // this it fired a full month build on launch and every 60 seconds after,
    // for a sheet nobody had tapped.
    enabled: initData !== MISSING_INIT_DATA && (opts?.enabled ?? true),
    queryFn: () => fetchCalendar(initData, startDate, endDate),
    // WHILE ON SCREEN ONLY. Refetching on resume covers a minimised app coming
    // back, and misses the case this exists for: the app open on screen while
    // the person walks to the terminal and punches. Without a poll the header
    // keeps saying "In" after they have clocked out, which is not a stale
    // number but a false statement about where somebody is.
    //
    // 60s because the claim is about the present and a minute is the
    // resolution the times are shown at.
    //
    // Gated on Telegram's OWN activity signal, not on the interval option's
    // default. `refetchIntervalInBackground: false` decides via
    // document.visibilityState, and a minimised Mini App is not reliably
    // marked hidden -- it drops behind the chat and keeps running. Left to
    // that default this polls all afternoon on an employee's mobile data
    // against a sheet nobody is looking at.
    //
    // Opt-out for callers whose number does not move with the wall clock. The
    // Profile tab's month range is one: a month of days re-fetched every minute
    // on an employee's mobile data, to keep a count of days worked that changes
    // twice a day. Resuming the app already invalidates this key, which is the
    // moment the figure can actually be stale.
    //
    // And never against a verdict. A 403 re-polled every minute is the shape
    // this app shipped: the message said "try again in a moment", and it did,
    // for as long as the app was open.
    refetchInterval: (query) =>
      active && (opts?.poll ?? true) && !isPermanentRejection(query.state.error)
        ? 60_000
        : false,
  });
}

/** Telegram's activity state, as React state. See `isAppActive`. */
function useIsAppActive(): boolean {
  const [active, setActive] = useState(() => isAppActive(window));
  useEffect(() => {
    // Re-read on subscribe as well as on transition: the app can be launched,
    // minimised and resumed before this effect first runs, and the missed
    // transition would leave the poll off for the rest of the session.
    setActive(isAppActive(window));
    return onActiveChange(window, setActive);
  }, []);
  return active;
}

/**
 * What get_my_profile returns.
 *
 * Every field but `employee` and `biometric` is nullable BY CONTRACT rather
 * than by oversight: HR records are unevenly filled, and Profile drops a row
 * rather than rendering a dash under a label.
 */
export type MiniProfile = {
  employee: string;
  employee_name?: string | null;
  khmer_name?: string | null;
  designation?: string | null;
  image?: string | null;
  department?: string | null;
  employment_type?: string | null;
  date_of_joining?: string | null;
  branch?: string | null;
  reports_to_name?: string | null;
  cell_number?: string | null;
  personal_email?: string | null;
  biometric: Biometric;
};

async function fetchProfile(initData: string): Promise<MiniProfile> {
  const response = await fetch(
    "/api/method/dewey_time.telegram.miniapp_api.get_my_profile",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": window.csrf_token ?? "",
      },
      body: JSON.stringify({ init_data: initData }),
    },
  );
  if (!response.ok) {
    throw new FrappeCallError(`profile request failed: ${response.status}`, {
      status: response.status,
      method: PROFILE_METHOD,
    });
  }
  return (await response.json()).message as MiniProfile;
}

export function useMyProfile() {
  const initData = initDataFromTelegram(window);
  return useQuery({
    queryKey: ["mini-profile"],
    // Outside Telegram there is nothing to authenticate with, so the request
    // is never fired -- the shell shows an explanation instead of a 403.
    enabled: initData !== MISSING_INIT_DATA,
    queryFn: () => fetchProfile(initData),
    // NO POLL, unlike the calendar. That one polls because it makes a claim
    // about the PRESENT ("In") which goes false while somebody walks to the
    // terminal. Nothing here changes during a session, and polling an
    // unchanging record on an employee's mobile data buys nothing.
  });
}

/** Index a payload's days by date, the shape every timeline helper wants. */
export function daysByDate(payload: MiniCalendar | undefined): Map<string, Day> {
  const map = new Map<string, Day>();
  for (const day of payload?.days ?? []) map.set(day.date, day);
  return map;
}

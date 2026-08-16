import { useQuery } from "@tanstack/react-query";

import type { Day } from "@/types/calendar";

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
  employee_branch?: string | null;
  days: Day[];
};

/**
 * The viewer's Telegram avatar, if the client offered one.
 *
 * From `initDataUnsafe`, which is explicitly untrusted — and that is fine for
 * exactly this: it is decoration beside a name the SERVER supplied. Nothing is
 * decided by it. It is never used to identify anyone.
 */
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
    throw new Error(`calendar request failed: ${response.status}`);
  }
  return (await response.json()).message as MiniCalendar;
}

export function useMiniAppCalendar(startDate: string, endDate: string) {
  const initData = initDataFromTelegram(window);
  return useQuery({
    queryKey: ["mini-calendar", startDate, endDate],
    // Outside Telegram there is nothing to authenticate with, so the request
    // is never fired -- the shell shows an explanation instead of a 403.
    enabled: initData !== MISSING_INIT_DATA,
    queryFn: () => fetchCalendar(initData, startDate, endDate),
  });
}

/** Index a payload's days by date, the shape every timeline helper wants. */
export function daysByDate(payload: MiniCalendar | undefined): Map<string, Day> {
  const map = new Map<string, Day>();
  for (const day of payload?.days ?? []) map.set(day.date, day);
  return map;
}

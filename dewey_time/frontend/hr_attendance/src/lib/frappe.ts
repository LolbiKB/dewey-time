/**
 * Frappe transport for react-query.
 *
 * Generalises the pattern already proven in `pwa/push.ts:5-16`: same-origin
 * `/api/method/<dotted.path>`, session cookie via `credentials: "include"`, and
 * `X-Frappe-CSRF-Token` read from the `window.csrf_token` the host page injects
 * (`www/hr-attendance.html:23`, `www/hr-schedule.html:23`).
 *
 * Two things it adds over push.ts's local `call()`:
 *   - GET support, so reads are cacheable and carry no CSRF token (Frappe only
 *     requires one for writes).
 *   - Real error extraction. push.ts throws `Error("<method> failed (500)")`,
 *     discarding `_server_messages` — the only place a server-side
 *     `frappe.throw()` message actually lives. Routing the error body through
 *     `extractFrappeError` is what lets the UI show what the server said.
 */
import { extractFrappeError } from "@/lib/frappeError";

export class FrappeCallError extends Error {
  readonly status: number;
  readonly method: string;

  constructor(message: string, opts: { status: number; method: string }) {
    super(message);
    this.name = "FrappeCallError";
    this.status = opts.status;
    this.method = opts.method;
  }
}

export type FrappeCallOptions = { method?: "GET" | "POST" };

function csrfToken(): string {
  return (window as unknown as { csrf_token?: string }).csrf_token || "";
}

export async function frappeCall<T>(
  method: string,
  params?: Record<string, unknown>,
  opts: FrappeCallOptions = {},
): Promise<T> {
  const verb = opts.method ?? "GET";
  let url = `/api/method/${method}`;
  const init: RequestInit = { method: verb, credentials: "include" };

  if (verb === "GET") {
    if (params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        // Frappe accepts scalars raw and structures JSON-encoded.
        search.set(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      const qs = search.toString();
      if (qs) url += `?${qs}`;
    }
    init.headers = { Accept: "application/json" };
  } else {
    init.headers = {
      "Content-Type": "application/json",
      "X-Frappe-CSRF-Token": csrfToken(),
    };
    init.body = params ? JSON.stringify(params) : undefined;
  }

  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new FrappeCallError(extractFrappeError(body, `${method} failed (${res.status})`), {
      status: res.status,
      method,
    });
  }

  // `body` is null whenever res.json() rejected above — an empty 204, or the
  // HTML login page Frappe serves with a 200 when the session has expired.
  // Destructuring that yields an opaque TypeError; callers only ever catch
  // FrappeCallError, so the failure has to arrive as one.
  if (body === null || typeof body !== "object" || !("message" in body)) {
    throw new FrappeCallError(`${method} returned no JSON envelope (${res.status})`, {
      status: res.status,
      method,
    });
  }

  return (body as { message: T }).message;
}

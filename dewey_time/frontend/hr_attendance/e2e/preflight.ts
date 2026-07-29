import { DEV_ORIGIN, DEV_PORT } from "../devPort";

/**
 * Marker proving the origin is OUR dev server. `index.html` has carried this
 * title since the app existed; it is served verbatim by Vite in dev (the Jinja
 * in the file is only interpolated when Frappe serves the built page).
 */
const MARKER = "<title>HR Attendance</title>";

/**
 * Fails fast when the e2e origin is answered by an app that is not this one.
 *
 * Playwright's `reuseExistingServer` (on whenever CI is unset) means that if
 * ANYTHING answers on the port, Playwright assumes it is our dev server and
 * skips starting its own. The suite then runs every test against a stranger's
 * app and every assertion fails, with nothing in the output mentioning ports.
 * That is not hypothetical — it cost real time during #69, when another local
 * project held 8080 and a 26-test wipeout looked like a catastrophic
 * regression. See issue #72.
 *
 * Deliberately silent when nothing answers: this hook must not assume whether
 * Playwright runs it before or after `webServer`. Before, on a clean machine,
 * the origin is legitimately dead and Vite is about to take it — erroring there
 * would break the normal path. Checking only a LIVE origin is correct under
 * either ordering, since a live-but-foreign origin is the failure we are
 * catching and a live-and-ours origin passes.
 */
export default async function preflight(): Promise<void> {
  let html: string;
  try {
    const res = await fetch(DEV_ORIGIN, { signal: AbortSignal.timeout(5_000) });
    html = await res.text();
  } catch {
    // Nothing listening (or too slow to be a running dev server) — let
    // Playwright's webServer boot Vite. If that fails, it reports its own error.
    return;
  }

  if (html.includes(MARKER)) return;

  throw new Error(
    [
      `Port ${DEV_PORT} is held by something that is not the HR Attendance dev server.`,
      ``,
      `  ${DEV_ORIGIN} answered, but its HTML does not contain ${MARKER}.`,
      ``,
      `Playwright reuses an existing server when one answers, so the whole suite`,
      `would otherwise run against that other app and fail every test without ever`,
      `mentioning the port. Either stop whatever owns ${DEV_PORT}, or move this run:`,
      ``,
      `  PORT=8099 npm run test:e2e`,
    ].join("\n"),
  );
}

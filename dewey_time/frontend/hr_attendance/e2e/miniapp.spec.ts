import { expect, test, type Page } from "@playwright/test";

/**
 * The Telegram Mini App, in a browser.
 *
 * Until this file the Mini App had no browser coverage at all, and three of
 * its bugs had already been found only by opening it by hand: a Tooltip
 * outside its provider, a DayCell collapsing to a 35px sliver, and every punch
 * drawing as an anomaly because one field was missing from the API allowlist.
 * None of those could fail a node:test — this suite has no DOM.
 *
 * The app is served by the SAME dev server as the HR SPA (one vite root, two
 * HTML entries), so it is reachable at the entry's own path.
 */

const MINIAPP = "/index.miniapp.html";

/** A day the fixture calls "worked": two punches around a 08:00–17:00 shift. */
function workedDay(date: string) {
  return {
    date,
    shift: {
      shift_assigned: true,
      shift_type: "FT_0800_1700",
      start_time: "08:00:00",
      end_time: "17:00:00",
      lunch_start: "12:00:00",
      lunch_end: "13:00:00",
    },
    holiday: null,
    leave: { on_leave: false },
    observed_lunch: null,
    first_in: `${date} 07:58:00`,
    last_out: `${date} 17:06:00`,
    checkins: [
      { time: `${date} 07:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${date} 12:01:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
      { time: `${date} 12:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${date} 17:06:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
    ],
  };
}

/**
 * Inject Telegram's SDK before any app code runs, and stub the one endpoint.
 *
 * `addInitScript`, not an evaluate: the shell reads `Telegram.WebApp.initData`
 * during its first render to decide whether to show anything at all, so a stub
 * installed after load would be too late and the app would render its
 * "open this from Telegram" notice instead.
 */
async function openMiniApp(page: Page, opts: { theme?: "light" | "dark"; themeParams?: Record<string, string> } = {}) {
  await page.addInitScript(
    ({ theme, themeParams }) => {
      const handlers: Record<string, (() => void)[]> = {};
      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          initData: "user=%7B%22id%22%3A55501%7D&auth_date=1&hash=deadbeef",
          initDataUnsafe: { user: { id: 55501 } },
          colorScheme: theme ?? "light",
          themeParams: themeParams ?? {},
          safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
          contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
          BackButton: {
            isVisible: false,
            show() { (this as { isVisible: boolean }).isVisible = true; },
            hide() { (this as { isVisible: boolean }).isVisible = false; },
            onClick() {},
            offClick() {},
          },
          HapticFeedback: { selectionChanged() {}, impactOccurred() {}, notificationOccurred() {} },
          ready() {},
          expand() {},
          disableVerticalSwipes() {},
          setHeaderColor() {},
          setBackgroundColor() {},
          setBottomBarColor() {},
          onEvent(name: string, handler: () => void) {
            (handlers[name] ||= []).push(handler);
          },
          offEvent(name: string, handler: () => void) {
            handlers[name] = (handlers[name] || []).filter((h) => h !== handler);
          },
        },
      };
    },
    { theme: opts.theme, themeParams: opts.themeParams },
  );

  // Telegram's real SDK is a third-party CDN script and there is no network
  // here. Aborted rather than left to time out — the stub above already
  // provides everything the app reads, and this also proves the page renders
  // when that script never arrives, which is the failure the `defer` in
  // index.miniapp.html exists to survive.
  await page.route("https://telegram.org/**", (route) => route.abort());

  await page.route("**/api/method/dewey_time.telegram.miniapp_api.get_my_calendar", async (route) => {
    const body = route.request().postDataJSON() as { start_date: string; end_date: string };
    const days = [];
    const cursor = new Date(`${body.start_date}T00:00:00`);
    const last = new Date(`${body.end_date}T00:00:00`);
    while (cursor <= last) {
      // Formatted LOCALLY. toISOString() is UTC, and east of Greenwich that
      // shifts every key back a day — the payload then answers a range the
      // app never asked for and every row reads "Day off". Measured here on
      // the first run of this file.
      const key = [
        cursor.getFullYear(),
        String(cursor.getMonth() + 1).padStart(2, "0"),
        String(cursor.getDate()).padStart(2, "0"),
      ].join("-");
      // Every day worked, deliberately: the tests below assert on "today" and
      // on the current week, and a weekend rule would make them pass or fail
      // depending on which day of the week the suite runs.
      days.push(workedDay(key));
      cursor.setDate(cursor.getDate() + 1);
    }
    await route.fulfill({
      json: {
        message: {
          employee: "HR-EMP-00042",
          employee_name: "Sok Dara",
          khmer_name: "សុខ ដារា",
          designation: "Cashier",
          employee_branch: "DIS Iconic",
          days,
        },
      },
    });
  });

  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(MINIAPP);
}

test("the identity header names the record the server resolved", async ({ page }) => {
  // The confirmation that matters: not the viewer's Telegram name, which they
  // already know, but WHICH employee record their account is bound to.
  await openMiniApp(page);
  const header = page.getByRole("banner", { name: "Your record" });
  await expect(header).toContainText("Sok Dara");
  await expect(header).toContainText("សុខ ដារា");
  await expect(header).toContainText("Cashier · DIS Iconic");
  await expect(header).toContainText("HR-EMP-00042");
});

test("the day tab summarises the day above its timeline", async ({ page }) => {
  await openMiniApp(page);
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Rostered 08:00 – 17:00");
  await expect(summary).toContainText("In");
  await expect(summary).toContainText("Out");
  await expect(summary).toContainText("Worked");
});

test("the week tab pages between weeks and cannot go past this one", async ({ page }) => {
  await openMiniApp(page);
  await page.getByRole("button", { name: "Week", exact: true }).click();

  await expect(page.getByText("This week", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next week" })).toBeDisabled();

  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(page.getByRole("button", { name: "Back to this week" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next week" })).toBeEnabled();

  await page.getByRole("button", { name: "Back to this week" }).click();
  await expect(page.getByText("This week", { exact: true })).toBeVisible();
});

test("tapping a day in the week opens that day, and Telegram's back button returns", async ({ page }) => {
  await openMiniApp(page);
  await page.getByRole("button", { name: "Week", exact: true }).click();

  const monday = page.getByRole("button", { name: /^Monday .*:/ });
  await expect(monday).toBeVisible();
  await monday.click();

  // The day tab, showing that day rather than today.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Monday");
  // Telegram's own back button is the way out — not one we drew ourselves.
  const shown = await page.evaluate(
    () => (window as unknown as { Telegram: { WebApp: { BackButton: { isVisible: boolean } } } })
      .Telegram.WebApp.BackButton.isVisible,
  );
  expect(shown, "a drill-in with no way back strands the reader").toBe(true);
});

test("nothing overflows the viewport at a phone width", async ({ page }) => {
  // The sheet is the whole app. A page that scrolls sideways inside Telegram
  // reads as broken, and the tab bar is the row that gets pushed off.
  await openMiniApp(page);
  for (const tab of ["Today", "Week", "Schedule"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, `${tab} overflows by ${overflow.scroll - overflow.client}px`)
      .toBeLessThanOrEqual(overflow.client + 1);
    await expect(page.getByRole("button", { name: tab, exact: true })).toBeInViewport();
  }
});

test("a Telegram theme's colours reach the app's own surfaces", async ({ page }) => {
  // The design guidelines ask apps to follow the client's theme. dewey-ui's
  // fixed greys inside a themed Telegram are the clearest possible sign that
  // this is a webview somebody embedded.
  await openMiniApp(page, {
    theme: "dark",
    themeParams: { bg_color: "#17212b", text_color: "#f5f5f5", hint_color: "#708499" },
  });
  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
  );
  expect(bg).toBe("#17212b");
});

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

/**
 * A rostered 08:00–17:00 day, at one of four points through it.
 *
 * `none` and `open` are the two whose STATUS does not move with the wall
 * clock — no punches is always "Not checked in", and a trailing in-punch is
 * always "In" — which is why the header assertions below use those two. A
 * finished day reads "Out during shift" before 5pm and "Checked out" after,
 * so asserting on it would pass in the morning and fail in the evening.
 */
type Punches = "none" | "open" | "partial" | "full";

function rosteredDay(date: string, punches: Punches = "full") {
  const all = [
    { time: `${date} 07:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
    { time: `${date} 12:01:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
    { time: `${date} 12:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
    { time: `${date} 17:06:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
  ];
  const checkins = all.slice(0, { none: 0, open: 1, partial: 3, full: 4 }[punches]);
  const outs = checkins.filter((c) => c.log_type === "OUT");
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
    first_in: checkins.length ? checkins[0]!.time : null,
    last_out: outs.length ? outs[outs.length - 1]!.time : null,
    checkins,
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
async function openMiniApp(page: Page, opts: { theme?: "light" | "dark"; themeParams?: Record<string, string>; languageCode?: string; punched?: Punches } = {}) {
  await page.addInitScript(
    ({ theme, themeParams, languageCode }) => {
      const handlers: Record<string, (() => void)[]> = {};
      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          initData: "user=%7B%22id%22%3A55501%7D&auth_date=1&hash=deadbeef",
          initDataUnsafe: { user: { id: 55501, language_code: languageCode } },
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
    { theme: opts.theme, themeParams: opts.themeParams, languageCode: opts.languageCode },
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
      // Every day the same, deliberately: the tests below assert on "today"
      // and on the current week, and a weekend rule would make them pass or
      // fail depending on which day of the week the suite runs.
      days.push(rosteredDay(key, opts.punched ?? "full"));
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

test("the day tab is the timeline, and nothing restates it", async ({ page }) => {
  // There is no summary block. It used to sit here and say, in text, what the
  // canvas below draws: the punch times, the rostered window, the lunch gap.
  // Three lines to read past on the way to the picture that already said it.
  await openMiniApp(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Today");
  await expect(page.getByRole("region", { name: "Summary" })).toHaveCount(0);

  // The canvas itself, carrying the punch times on the blocks — ONCE. This is
  // the assertion that would catch the block coming back.
  await expect(page.getByText("7:58AM")).toHaveCount(1);
  await expect(page.getByText("5:06PM")).toHaveCount(1);
  // And the hour axis, without which a lone timeline has no scale to read on.
  await expect(page.getByText("8 AM", { exact: true })).toBeVisible();
});

test("a day with no punches still renders its timeline, and says you are not in", async ({ page }) => {
  // The state that reported this whole thread. With the summary gone the only
  // text on this tab is the date and the status, so an empty canvas here would
  // be a blank screen rather than a quiet one.
  await openMiniApp(page, { punched: "none" });
  const header = page.getByRole("heading", { level: 1 }).locator("xpath=..");
  await expect(header).toContainText("Today");
  await expect(header).toContainText("Not checked in");
  await expect(page.getByRole("region", { name: "Summary" })).toHaveCount(0);
  await expect(page.getByText("8 AM", { exact: true })).toBeVisible();
  await expect(page.getByText("7:58AM")).toHaveCount(0);
});

test("clocked in and not yet out reads as In, with the branch", async ({ page }) => {
  // Time-independent by construction: a trailing IN punch is "In" at any hour,
  // where a finished day reads "Out during shift" before 5pm and "Checked out"
  // after — an assertion that would pass in the morning and fail at night.
  //
  // This is also the state the old summary got WRONG. It read the day through
  // formatDayCheckinTimeRange, which needs a last_out, so someone who had
  // clocked in an hour ago was told "No punches recorded" while the canvas
  // below drew their punch.
  await openMiniApp(page, { punched: "open" });
  const header = page.getByRole("heading", { level: 1 }).locator("xpath=..");
  await expect(header).toContainText("In · DIS Iconic");
  await expect(header).not.toContainText("No punches recorded");

  // And the canvas cannot cover for it: one unpaired punch draws as a marker
  // with a hover tooltip, not as a labelled block, so on a touch screen this
  // chip is the ONLY place the state is written down.
  await expect(page.getByText("7:58AM")).toHaveCount(0);
  await expect(page.getByText("8 AM", { exact: true })).toBeVisible();
});

test("the day header does not wrap in Khmer at a narrow width", async ({ page }) => {
  // The date and the status share one row, which is the arrangement that
  // failed the first time round: Khmer labels are clauses where English ones
  // are two words. Height is the measurement, because a wrap is invisible to
  // every assertion about text.
  await openMiniApp(page, { languageCode: "km", punched: "open" });
  const header = page.getByRole("heading", { level: 1 }).locator("xpath=..");
  await expect(header).toBeVisible();
  const wide = (await header.boundingBox())!.height;

  await page.setViewportSize({ width: 320, height: 700 });
  const narrow = (await header.boundingBox())!.height;
  expect(narrow, `the Khmer header grew ${narrow - wide}px narrower — something wrapped`)
    .toBeLessThanOrEqual(wide);
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

  // NOT today. The heading reads "Today" for the current date by design, so a
  // hardcoded Monday made this test fail every Monday — it asserted the
  // heading names the day, and on one day in seven the correct heading does
  // not. Pick any other day of the same week instead.
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const other = todayName === "Monday" ? "Tuesday" : "Monday";
  const row = page.getByRole("button", { name: new RegExp(`^${other} .*:`) });
  await expect(row).toBeVisible();
  await row.click();

  // The day tab, showing that day rather than today.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(other);
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

test("the schedule tab reads in 12-hour time and names the break", async ({ page }) => {
  // This tab showed a bare 24-hour span and a total, so an employee could not
  // tell whether "8h" already had lunch taken out — the single most asked
  // question about a roster.
  await openMiniApp(page);
  await page.getByRole("button", { name: "Schedule", exact: true }).click();

  const list = page.getByRole("list");
  await expect(list).toContainText("8:00 AM – 5:00 PM");
  await expect(list).toContainText("Lunch 12:00 PM – 1:00 PM");
  await expect(list).not.toContainText("08:00 – 17:00");
  await expect(page.getByText("Rostered this week, net of lunch")).toBeVisible();
});

test("the schedule tab can look forward, because a roster is published ahead", async ({ page }) => {
  // The Week tab is capped at the current week — attendance has not happened
  // yet. A roster has, and looking at next week is the main reason to open
  // this tab at all.
  await openMiniApp(page);
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Next week" })).toBeEnabled();
});

test("a Khmer client opens in Khmer, and can switch back", async ({ page }) => {
  // Telegram's language_code decides the opening language. It comes from
  // initDataUnsafe — untrusted, and correctly so: nothing is authorised by it,
  // it only picks which column of a string table is read.
  await openMiniApp(page, { languageCode: "km" });

  await expect(page.getByRole("button", { name: "ថ្ងៃនេះ", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "កាលវិភាគ", exact: true })).toBeVisible();

  // The toggle is labelled in the language it switches TO: someone stuck in a
  // language they cannot read needs the way out to be the thing they can read.
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
});

test("a Khmer interface has no Latin digits left anywhere in it", async ({ page }) => {
  // The mechanical check, deliberately: a half-translated interface keeps its
  // numerals, and the numerals are the half carrying the information. Asserting
  // on the ABSENCE of [0-9] catches any surface someone adds later without a
  // formatter, which naming individual strings would not.
  //
  // Scoped to the app's own regions. The hour gutter down the timeline is the
  // shared HR `DayCell` axis and is still Latin — see the note in MyDayPage.
  await openMiniApp(page, { languageCode: "km", punched: "full" });

  const header = page.getByRole("heading", { level: 1 }).locator("xpath=..");
  await expect(header).toContainText("សីហា");
  expect(await header.innerText(), "the Day heading kept Latin numerals")
    .not.toMatch(/[0-9]/);

  await page.getByRole("button", { name: "សប្តាហ៍", exact: true }).click();
  const week = page.getByRole("list");
  await expect(week).toBeVisible();
  expect(await week.innerText(), "a Week row kept Latin numerals").not.toMatch(/[0-9]/);
  // And the total under it, which is a duration rather than a date.
  const weekTotal = page.getByText("ម៉ោងធ្វើការសប្តាហ៍នេះ (ដកម៉ោងសម្រាក)");
  await expect(weekTotal.locator("xpath=..")).not.toContainText(/[0-9]/);

  await page.getByRole("button", { name: "កាលវិភាគ", exact: true }).click();
  const schedule = page.getByRole("list");
  await expect(schedule).toBeVisible();
  expect(await schedule.innerText(), "a Schedule row kept Latin numerals")
    .not.toMatch(/[0-9]/);
});

test("the same screens in English are unchanged, digits and all", async ({ page }) => {
  // The positive control. Without it the test above passes just as well on a
  // screen that renders no numbers at all.
  await openMiniApp(page, { languageCode: "en", punched: "full" });
  const header = page.getByRole("heading", { level: 1 }).locator("xpath=..");
  await expect(header).toContainText("August");
  expect(await header.innerText()).toMatch(/[0-9]/);

  await page.getByRole("button", { name: "Week", exact: true }).click();
  const week = page.getByRole("list");
  await expect(week).toContainText("8h 11m");
  await expect(week).toContainText("7:58 AM – 5:06 PM");
});

test("an English client is not given a Khmer interface it did not ask for", async ({ page }) => {
  // Guessing Khmer from a region or a timezone would put an unreadable
  // interface in front of the people least able to report it.
  await openMiniApp(page, { languageCode: "en" });
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "ភាសាខ្មែរ" })).toBeVisible();
});

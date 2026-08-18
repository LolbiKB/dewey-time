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

function rosteredDay(date: string, punches: Punches = "full", flags: unknown[] = []) {
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
    // The narrowed four-field shape miniapp_api.FLAG_KEYS produces — never the
    // HR row. A fixture richer than the server can send would let the sheet
    // read a field that does not exist in production.
    flags,
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
async function openMiniApp(page: Page, opts: { theme?: "light" | "dark"; themeParams?: Record<string, string>; languageCode?: string; punched?: Punches; fullscreen?: boolean; flags?: unknown[]; profile?: Record<string, unknown> } = {}) {
  await page.addInitScript(
    ({ theme, themeParams, languageCode, fullscreen }) => {
      const handlers: Record<string, (() => void)[]> = {};
      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          initData: "user=%7B%22id%22%3A55501%7D&auth_date=1&hash=deadbeef",
          initDataUnsafe: { user: { id: 55501, language_code: languageCode } },
          colorScheme: theme ?? "light",
          themeParams: themeParams ?? {},
          // Fullscreen on a notched phone: a 47px notch with Telegram's own
          // 56px header BELOW it. They stack; they are not alternatives.
          safeAreaInset: fullscreen
            ? { top: 47, bottom: 34, left: 0, right: 0 }
            : { top: 0, bottom: 0, left: 0, right: 0 },
          contentSafeAreaInset: fullscreen
            ? { top: 56, bottom: 0, left: 0, right: 0 }
            : { top: 0, bottom: 0, left: 0, right: 0 },
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
    {
      theme: opts.theme,
      themeParams: opts.themeParams,
      languageCode: opts.languageCode,
      fullscreen: !!opts.fullscreen,
    },
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
      days.push(rosteredDay(key, opts.punched ?? "full", opts.flags ?? []));
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

  await page.route("**/api/method/dewey_time.telegram.miniapp_api.get_my_profile", async (route) => {
    // The narrowed shape miniapp_api.get_my_profile produces — never a richer
    // one. A fixture the server cannot send lets the page read a field that
    // does not exist in production.
    //
    // `fingers: []` is not laziness: the bridge collapses templates to a count
    // before Frappe sees them, so an empty list IS what production returns for
    // everybody today.
    await route.fulfill({
      json: {
        message: opts.profile ?? {
          employee: "HR-EMP-00042",
          employee_name: "Sok Dara",
          khmer_name: "សុខ ដារា",
          designation: "Cashier",
          image: null,
          department: "Retail",
          employment_type: "Full-time",
          date_of_joining: "2024-03-12",
          branch: "DIS Iconic",
          reports_to_name: "Chan Sophea",
          cell_number: "012 345 678",
          personal_email: "dara.sok@gmail.com",
          biometric: {
            state: "enrolled",
            fingers: [],
            fingerprint_count: 2,
            face: false,
            checked_at: "2026-08-17 06:00:00",
          },
        },
      },
    });
  });

  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(MINIAPP);
}

/**
 * Ten days ago, as a date string.
 *
 * RELATIVE, not a literal. A hard-coded joining date is measured against the
 * real clock, so "joined less than a month ago" quietly becomes false a few
 * weeks after it is written — and the assertion that no "0mo" is rendered then
 * passes because the page says "1mo", which is not what it is guarding.
 */
function recentlyJoined(): string {
  const d = new Date();
  d.setDate(d.getDate() - 10);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** A record with almost nothing filled in — the state that decides whether the
 *  page reads as deliberate or broken. */
function sparseProfile(biometric: Record<string, unknown>) {
  return {
    employee: "HR-EMP-00311",
    employee_name: "Kim Veasna",
    khmer_name: null,
    designation: null,
    image: null,
    department: null,
    employment_type: null,
    date_of_joining: recentlyJoined(),
    branch: null,
    reports_to_name: null,
    cell_number: null,
    personal_email: null,
    biometric,
  };
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

test("the calendar pages back three months and never forward of this one", async ({ page }) => {
  // Three months TOTAL, this one included. The bound reads two ways and the
  // difference is a whole month, so it is exercised rather than described.
  await openMiniApp(page);
  await page.getByRole("button", { name: /Choose a date/ }).first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();

  const back = sheet.getByRole("button", { name: /previous month/i });
  const forward = sheet.getByRole("button", { name: /next month/i });

  await expect(forward, "nothing is recorded in the future").toBeDisabled();

  await back.click();
  await expect(forward).toBeEnabled();
  await back.click();
  await expect(back, "three months of reach, and no more").toBeDisabled();
});

test("the calendar opens as a bottom sheet and picking a day lands on it", async ({ page }) => {
  await openMiniApp(page);
  await page.getByRole("button", { name: /Choose a date/ }).first().click();

  const sheet = page.getByRole("dialog");
  // A BOTTOM sheet, not a centre dialog: it must sit against the bottom edge
  // at every width, which is why ResponsiveModal was not used.
  //
  // Retried rather than measured once. The sheet SLIDES UP, so a single
  // reading lands mid-animation — the first version of this failed by exactly
  // the distance still left to travel, which looks identical to a sheet
  // rendered in the wrong place.
  const viewport = page.viewportSize()!;
  await expect(async () => {
    const box = (await sheet.boundingBox())!;
    expect(
      Math.abs(box.y + box.height - viewport.height),
      "the sheet must be anchored to the bottom edge",
    ).toBeLessThanOrEqual(2);
  }).toPass({ timeout: 5_000 });

  // A day that is not today, so the heading has to name it.
  const todayNum = new Date().getDate();
  const pick = todayNum > 3 ? todayNum - 2 : todayNum + 2;
  await sheet.getByRole("button", { name: new RegExp(`^\\w+day ${pick} \\w+`) }).first().click();

  await expect(sheet).not.toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(String(pick));
});

test("tapping a day in the calendar opens it, and Telegram's back button returns", async ({ page }) => {
  await openMiniApp(page);
  await page.getByRole("button", { name: /Choose a date/ }).first().click();

  // NOT today. The heading reads "Today" for the current date by design, so
  // asserting it names the weekday would fail on whichever day was hardcoded.
  const now = new Date();
  const pickDay = now.getDate() > 3 ? now.getDate() - 2 : now.getDate() + 2;
  const picked = new Date(now.getFullYear(), now.getMonth(), pickDay);
  const weekday = picked.toLocaleDateString("en-US", { weekday: "long" });

  await page.getByRole("dialog")
    .getByRole("button", { name: new RegExp(`^${weekday} ${pickDay} \\w+`) }).first().click();

  // The day tab, showing that day rather than today.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(weekday);
  // Telegram's own back button is the way out — not one we drew ourselves.
  const shown = await page.evaluate(
    () => (window as unknown as { Telegram: { WebApp: { BackButton: { isVisible: boolean } } } })
      .Telegram.WebApp.BackButton.isVisible,
  );
  expect(shown, "a drill-in with no way back strands the reader").toBe(true);
});

test("every day announces its mark, not just draws it", async ({ page }) => {
  // THE GRID IS FORTY IDENTICAL CIRCLES TO A SCREEN READER, and the circles
  // are the entire reason it exists. This has to be asserted on the RENDERED
  // accessible name: react-day-picker sets its own aria-label on each day
  // button, which beats name-from-content, so the visually-hidden span that
  // looked right in the source announced nothing at all. A source-read test
  // passed the whole time it was broken.
  await openMiniApp(page, { punched: "full" });
  await page.getByRole("button", { name: /Choose a date/ }).first().click();

  const sheet = page.getByRole("dialog");
  const names = await sheet.getByRole("button").evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label")).filter(Boolean) as string[],
  );
  const days = names.filter((n) => /\d/.test(n) && /day/i.test(n));
  expect(days.length, "no day buttons found — the locator is wrong").toBeGreaterThan(20);

  // Every fixture day is a full 4-punch day, so each past one is complete.
  const withMark = days.filter((n) => /complete record|no clock-out|no record|not a working day/.test(n));
  expect(withMark.length, `no day named its mark: ${days[0]}`).toBeGreaterThan(0);
});

test("nothing overflows the viewport at a phone width", async ({ page }) => {
  // The sheet is the whole app. A page that scrolls sideways inside Telegram
  // reads as broken, and the tab bar is the row that gets pushed off.
  await openMiniApp(page);
  for (const tab of ["Today", "Profile"]) {
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
  await page.getByRole("button", { name: "Profile", exact: true }).click();

  const list = page.getByRole("list");
  await expect(list).toContainText("8:00 AM – 5:00 PM");
  await expect(list).toContainText("Lunch 12:00 PM – 1:00 PM");
  await expect(list).not.toContainText("08:00 – 17:00");
  await expect(page.getByText("Rostered this week, net of lunch")).toBeVisible();
});

test("the schedule tab can look forward, because a roster is published ahead", async ({ page }) => {
  // The calendar is capped at the current month — attendance has not happened
  // yet. A roster has, and looking at next week is the main reason to open
  // this tab at all.
  await openMiniApp(page);
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Next week" })).toBeEnabled();
});

test("a Khmer client opens in Khmer, and can switch back", async ({ page }) => {
  // Telegram's language_code decides the opening language. It comes from
  // initDataUnsafe — untrusted, and correctly so: nothing is authorised by it,
  // it only picks which column of a string table is read.
  await openMiniApp(page, { languageCode: "km" });

  await expect(page.getByRole("button", { name: "ថ្ងៃនេះ", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "ប្រវត្តិរូប", exact: true })).toBeVisible();

  // The toggle is labelled in the language it switches TO: someone stuck in a
  // language they cannot read needs the way out to be the thing they can read.
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
});

test("content scrolls clear of the tab bar on a half-height sheet", async ({ page }) => {
  // A Telegram sheet is frequently half the screen, and at that height the
  // last roster row was sliced horizontally by the tab bar's top border —
  // cut mid-row, with nothing to say more existed below.
  //
  // Measured SCROLLED TO THE END. Unscrolled, an overflowing list reports its
  // last row below the fold and the number means nothing, which is how the
  // first attempt at this measurement read -74px and looked like a failure.
  await openMiniApp(page, { punched: "full" });
  await page.setViewportSize({ width: 390, height: 520 });
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("list").waitFor();

  const main = page.locator("main");
  await main.evaluate((el) => { el.scrollTop = el.scrollHeight; });

  const nav = (await page.getByRole("navigation").boundingBox())!;
  const last = (await main.locator("> * > *").last().boundingBox())!;
  const gap = nav.y - (last.y + last.height);
  expect(gap, `the last row sits ${gap}px from the tab bar`).toBeGreaterThanOrEqual(20);
});

test("nothing sits under Telegram's own controls in fullscreen", async ({ page }) => {
  // Telegram draws its close and collapse buttons in the TOP-RIGHT corner,
  // and this app puts the employee's avatar row and the language toggle in
  // exactly the same place. A tap meant to switch language closed the app.
  //
  // The cause was taking Math.max of the two insets. They are not two
  // measurements of one edge: safeAreaInset is the notch, measured from the
  // screen; contentSafeAreaInset is Telegram's header, measured from inside
  // that. On a 47px notch under a 56px header, max returns 56 and the app's
  // first row lands in the middle of Telegram's chrome. They add: 103.
  await openMiniApp(page, { punched: "full", fullscreen: true });

  const header = page.getByRole("banner", { name: "Your record" });
  const box = (await header.boundingBox())!;
  expect(box.y, `the identity row starts at ${box.y}px, inside Telegram's chrome`)
    .toBeGreaterThanOrEqual(47 + 56);

  // And the toggle specifically, since it is the rightmost thing on that row
  // and the close button is the rightmost thing on Telegram's.
  const toggle = (await page.getByRole("button", { name: "ភាសាខ្មែរ" }).boundingBox())!;
  expect(toggle.y).toBeGreaterThanOrEqual(47 + 56);
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

  // The calendar sheet: month caption, weekday headers, every day number and
  // the month total. The caption is the one date-fns does NOT localise — it
  // gives សីហា and then "2026" — so it is inside this sweep deliberately.
  await page.getByRole("button", { name: /ជ្រើសរើសថ្ងៃ/ }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  expect(await sheet.innerText(), "the calendar kept Latin numerals").not.toMatch(/[0-9]/);
  await page.keyboard.press("Escape");

  // The whole Profile tab, not just its roster. It carries a joining date, a
  // length of service, a fingerprint count, three month statistics and the
  // roster — five more places to forget a formatter than the roster alone, and
  // scoping this to the <ul> would have watched none of them.
  await page.getByRole("button", { name: "ប្រវត្តិរូប", exact: true }).click();
  const profile = page.getByRole("main");
  await expect(profile.getByRole("list")).toBeVisible();

  // TWO deliberate exceptions, both IDENTIFIERS rather than quantities — the
  // rule MiniIdentity already applies to the employee code in the header. You
  // dial a phone number and you read an employee id out to HR; neither is
  // counted, and a phone number in Khmer numerals has to be converted back
  // before it can be typed into a phone.
  const text = (await profile.innerText())
    .replace(/HR-EMP-\d+/g, "")
    .replace(/\d[\d ]{6,}/g, "");
  expect(text, "the Profile tab kept Latin numerals").not.toMatch(/[0-9]/);
});

test("the same screens in English are unchanged, digits and all", async ({ page }) => {
  // The positive control. Without it the test above passes just as well on a
  // screen that renders no numbers at all.
  await openMiniApp(page, { languageCode: "en", punched: "full" });
  const header = page.getByRole("heading", { level: 1 }).locator("xpath=..");
  await expect(header).toContainText("August");
  expect(await header.innerText()).toMatch(/[0-9]/);

  await page.getByRole("button", { name: /Choose a date/ }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("August");
  expect(await sheet.innerText(), "the English calendar must show digits").toMatch(/[0-9]/);
});

test("an English client is not given a Khmer interface it did not ask for", async ({ page }) => {
  // Guessing Khmer from a region or a timezone would put an unreadable
  // interface in front of the people least able to report it.
  await openMiniApp(page, { languageCode: "en" });
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "ភាសាខ្មែរ" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Day flags
//
// The unit tests for this feature read source text. That is not enough here and
// the reason is on the record: the calendar sheet shipped with marks that were
// silent to a screen reader while a source-read test passed the whole time, and
// only the rendered DOM showed it.
// ---------------------------------------------------------------------------

/** The narrowed shape miniapp_api.FLAG_KEYS produces. */
const miniFlag = (code: string, over: Record<string, unknown> = {}) => ({
  flag_code: code,
  is_provisional: false,
  decision: null,
  decision_state: "undecided",
  ...over,
});

test("a clean day shows no flags pill at all", async ({ page }) => {
  // Hidden at zero, not rendered as "0 to check" — the calendar mark already
  // says a day is clean and this is the shortest axis the app has.
  await openMiniApp(page);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("button", { name: /to check/ })).toHaveCount(0);
});

test("the pill's accessible name carries the count, and opens the sheet", async ({ page }) => {
  // Asserted against the RENDERED accessible name, not against source text.
  await openMiniApp(page, {
    flags: [
      miniFlag("LATE_START"),
      miniFlag("MISSING_TIME", {
        decision: { outcome: "EXCUSED" },
        decision_state: "matched",
      }),
    ],
  });

  const pill = page.getByRole("button", { name: "2 to check" });
  await expect(pill).toBeVisible();
  await pill.click();

  await expect(page.getByText("Late start")).toBeVisible();
  await expect(page.getByText("Awaiting HR review")).toBeVisible();
  await expect(page.getByText("Gap in your record")).toBeVisible();
  await expect(page.getByText("Excused by HR")).toBeVisible();
});

test("the sheet never shows the engine's own vocabulary", async ({ page }) => {
  await openMiniApp(page, { flags: [miniFlag("UNNOTIFIED_ABSENCE")] });
  await page.getByRole("button", { name: /to check/ }).click();
  const sheet = page.getByRole("dialog");
  // "Unnotified absence" is a verdict word; the record says no punches landed.
  await expect(sheet).toContainText("No record for this day");
  await expect(sheet).not.toContainText("UNNOTIFIED_ABSENCE");
  await expect(sheet).not.toContainText("CRITICAL");
});

test("a decision that no longer matches the day reads as awaiting review", async ({ page }) => {
  await openMiniApp(page, {
    flags: [miniFlag("LEFT_EARLY", {
      decision: { outcome: "EXCUSED" },
      decision_state: "needs_re_review",
    })],
  });
  await page.getByRole("button", { name: /to check/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Awaiting HR review again");
  await expect(sheet).not.toContainText("Excused by HR");
});

test("the pill counts in Khmer digits", async ({ page }) => {
  // A Latin "2" beside Khmer words is the exact leak miniIntl exists to close.
  await openMiniApp(page, {
    languageCode: "km",
    flags: [miniFlag("LATE_START")],
  });
  const pill = page.getByRole("button", { name: /ត្រូវពិនិត្យ/ });
  await expect(pill).toBeVisible();
  await expect(pill).not.toContainText(/[0-9]/);
});

test("the Profile tab shows the record, the devices and the roster", async ({ page }) => {
  await openMiniApp(page);
  await page.getByRole("button", { name: "Profile" }).click();

  await expect(page.getByText("Retail")).toBeVisible();
  await expect(page.getByText("Full-time")).toBeVisible();
  await expect(page.getByText("Chan Sophea")).toBeVisible();
  await expect(page.getByText("012 345 678")).toBeVisible();
  // No finger names — the bridge sends no slots, so a count is the honest form
  // and this is what every employee sees today.
  await expect(page.getByText("2 recorded")).toBeVisible();
  await expect(page.getByText("Your roster")).toBeVisible();
});

test("the roster inside Profile still pages forward past today", async ({ page }) => {
  // The reason the dated roster survived the tab it used to own: the calendar
  // sheet is disabled={{ after: today }}, so this is the app's only
  // forward-looking surface. Asserting the button merely EXISTS would pass
  // against a WeekNav rendered with forwardLimit — the week has to actually
  // move.
  await openMiniApp(page);
  await page.getByRole("button", { name: "Profile" }).click();

  await expect(page.getByText("This week", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next week" }).click();

  await expect(page.getByText("This week", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to this week" })).toBeVisible();
});

test("a device that does not know you says so, and says why it matters", async ({ page }) => {
  await openMiniApp(page, {
    profile: sparseProfile({
      state: "not_enrolled", fingers: [], fingerprint_count: 0,
      face: false, checked_at: "2026-08-17 06:00:00",
    }),
  });
  await page.getByRole("button", { name: "Profile" }).click();

  await expect(page.getByText("Not set up")).toBeVisible();
  await expect(page.getByText(/marked absent/)).toBeVisible();
  // A thin record drops whole blocks rather than dashing them.
  await expect(page.getByText("Contact HR has for you")).toHaveCount(0);
  await expect(page.getByText("Reports to")).toHaveCount(0);
  await expect(page.getByText("Department")).toHaveCount(0);
  // This fixture joined ten days ago, so the length of service is zero whole
  // months and "0mo" under the joining date would say nothing the date does
  // not. Asserting the row IS there first, so this cannot pass by the joining
  // date having vanished for some unrelated reason.
  await expect(page.getByText("Joined")).toBeVisible();
  await expect(page.getByText("0mo")).toHaveCount(0);
});

test("never having heard from the devices is not the same as not enrolled", async ({ page }) => {
  // The honesty rule, end to end: saying "not set up" when the truth is that
  // our snapshot is missing is the same failure as showing a provisional flag.
  await openMiniApp(page, {
    profile: sparseProfile({
      state: "unknown", fingers: [], fingerprint_count: 0,
      face: false, checked_at: null,
    }),
  });
  await page.getByRole("button", { name: "Profile" }).click();

  await expect(page.getByText("Not checked yet")).toBeVisible();
  await expect(page.getByText(/can't tell you either way/)).toBeVisible();
  await expect(page.getByText("Not set up")).toHaveCount(0);
});

test("the flags pill never overlaps the tab bar on a notched phone", async ({ page }) => {
  // The suite asserted the pill's TEXT and its sheet, never its box — which is
  // how a 35px overlap across the tab labels shipped and survived every run.
  // `fullscreen` is the 34px bottom inset; the pill used to be drawn inside it.
  await openMiniApp(page, { fullscreen: true, flags: [miniFlag("LATE_START")] });

  const pill = page.getByRole("button", { name: "1 to check" });
  await expect(pill).toBeVisible();

  const pillBox = await pill.boundingBox();
  const navBox = await page.getByRole("navigation").boundingBox();
  if (!pillBox || !navBox) throw new Error("pill or tab bar has no box");

  expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(navBox.y);
});

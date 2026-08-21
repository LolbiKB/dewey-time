// ---------------------------------------------------------------------------
// The app with no SDK at all
//
// NONE OF THESE CALL openMiniApp, and that omission is the test. Every other
// case in this file aborts the telegram.org script AND injects a complete
// window.Telegram stub, which proves only that an unused <script> can fail —
// the branch where the SDK genuinely never arrives has never been exercised,
// and it is the branch that told somebody inside Telegram to open the app
// from Telegram.
// ---------------------------------------------------------------------------

/** The hash Telegram itself writes onto the URL before the script is fetched. */
const LAUNCH_HASH =
  "#tgWebAppData=user%3D%257B%2522id%2522%253A55501%257D" +
  "&tgWebAppVersion=8.0&tgWebAppPlatform=android&tgWebAppThemeParams=%7B%7D";

test("inside Telegram with no SDK, the app offers a retry instead of sending you where you already are", async ({ page }) => {
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.goto(MINIAPP + LAUNCH_HASH);

  await expect(page.getByText(/finish loading/)).toBeVisible();
  await expect(page.getByText(/មិនទាន់ផ្ទុក/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Try again/ })).toBeVisible();
  // THE ASSERTION THAT IS THE BUG.
  await expect(page.getByText("Open this from Telegram")).toHaveCount(0);
});

test("a native client is recognised by its injected proxy, with no hash and no SDK", async ({ page }) => {
  // The commonest real shape: iOS and Android inject TelegramWebviewProxy and
  // the launch parameters arrive over it. Hash-only detection would miss this
  // one and show the wrong screen to most of the roster.
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.addInitScript(() => {
    (window as unknown as { TelegramWebviewProxy: unknown }).TelegramWebviewProxy = {
      postEvent() {},
    };
  });
  await page.goto(MINIAPP);

  await expect(page.getByText(/finish loading/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Try again/ })).toBeVisible();
});

test("a plain browser is still told to open it from Telegram, in both languages", async ({ page }) => {
  // The positive control for the two above: no hash, no proxy, no SDK. This
  // reader really is outside Telegram, and there is nothing here to retry.
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.goto(MINIAPP);

  await expect(page.getByText("Open this from Telegram")).toBeVisible();
  await expect(page.getByText("សូមបើកពី Telegram")).toBeVisible();
  await expect(page.getByRole("button", { name: /Try again/ })).toHaveCount(0);
});

test("a render crash shows a translated screen and never the JavaScript error", async ({ page }) => {
  // The crash screen is only reachable through a real throw, which is why it
  // shipped English-only with the error message printed on it for as long as
  // it did. Forced here by answering the calendar with a shape the app cannot
  // read: `days` as an OBJECT, which daysByDate's `for…of` cannot iterate.
  // (A string would be iterable and would not throw — the first version of
  // this test used one and the app rendered perfectly well.)
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.route("**/api/method/dewey_time.telegram.miniapp_api.get_my_calendar", (route) =>
    route.fulfill({ json: { message: { employee: "HR-EMP-00042", days: { nope: 1 } } } }),
  );
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: "user=%7B%22id%22%3A55501%7D&auth_date=1&hash=deadbeef",
        initDataUnsafe: { user: { id: 55501 } },
        colorScheme: "light", themeParams: {}, isActive: true,
        safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
        contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
        BackButton: { isVisible: false, show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {}, impactOccurred() {}, notificationOccurred() {} },
        ready() {}, expand() {}, disableVerticalSwipes() {},
        setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
        onEvent() {}, offEvent() {}, isVersionAtLeast: () => true,
      },
    };
  });
  await page.goto(MINIAPP);

  const crash = page.getByText(/could not be shown/);
  await expect(crash).toBeVisible();
  await expect(page.getByText(/មិនអាចបង្ហាញបានទេ/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Try again/ })).toBeVisible();

  // Nothing technical anywhere on the screen: no stack, no exception class,
  // no "is not a function". This is what the old card printed verbatim.
  const text = await page.locator("body").innerText();
  expect(text, "the crash screen leaked the JavaScript error").not.toMatch(
    /TypeError|undefined|not a function|\.tsx?:/,
  );
});

test("a telegram.org request that HANGS still explains itself", async ({ page }) => {
  // THE SHAPE route.abort() CANNOT PRODUCE, and the one the "didn't finish
  // loading" screen was written for. An aborted request settles: the deferred
  // script list moves on and the app renders. A request that neither succeeds
  // nor fails — a captive portal, a dying cell — used to leave main.tsx
  // fetched and never executed, because a deferred classic script and a module
  // script share one in-order execution list. No React, no boundary, no
  // notice, for as long as the socket stayed open.
  //
  // The SDK is loaded by the app now, with a clock on it. This waits out that
  // clock.
  await page.route("https://telegram.org/**", async () => {
    // Never fulfil, never abort.
    await new Promise(() => {});
  });
  // `waitUntil: "commit"`, because the page's own load event never fires while
  // that request is outstanding — which is itself the point: the app has to
  // render without it.
  await page.goto(MINIAPP + LAUNCH_HASH, { waitUntil: "commit" });

  await expect(page.getByText(/finish loading/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Try again/ })).toBeVisible();
});

test("an SDK that arrives late turns the notice into the real, fully-configured app", async ({ page }) => {
  // THE SELF-HEAL PATH, and the half that a redraw alone got wrong: expand(),
  // disableVerticalSwipes() and the theme all belong to initTelegramChrome, so
  // a bare re-render produced a light-themed app inside a dark client with
  // swipe-to-close live — the exact things waiting for the SDK exists to
  // prevent. Measured here rather than asserted in a comment.
  await page.route("https://telegram.org/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 7500));
    await route.fulfill({
      contentType: "application/javascript",
      body: `window.Telegram = { WebApp: {
        initData: "user=%7B%22id%22%3A55501%7D&auth_date=1&hash=deadbeef",
        initDataUnsafe: { user: { id: 55501 } },
        colorScheme: "dark", themeParams: {}, isActive: true,
        safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
        contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
        BackButton: { isVisible: false, show(){}, hide(){}, onClick(){}, offClick(){} },
        HapticFeedback: { selectionChanged(){}, impactOccurred(){}, notificationOccurred(){} },
        ready(){}, expand(){}, disableVerticalSwipes(){},
        setHeaderColor(){}, setBackgroundColor(){}, setBottomBarColor(){},
        onEvent(){}, offEvent(){}, isVersionAtLeast: () => true,
      } };`,
    });
  });
  await page.route("**/api/method/dewey_time.telegram.miniapp_api.get_my_calendar", (route) =>
    route.fulfill({ json: { message: { employee: "HR-EMP-00042", employee_name: "Sok Dara", days: [] } } }),
  );
  await page.goto(MINIAPP + LAUNCH_HASH, { waitUntil: "commit" });

  // First the honest interim answer...
  await expect(page.getByText(/finish loading/)).toBeVisible({ timeout: 15_000 });
  // ...then the real app, without anybody pressing anything.
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finish loading/)).toHaveCount(0);

  // And CONFIGURED: the dark class is initTelegramChrome's work, so its
  // presence is the proof that the late path did more than re-render.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(true);
});

test("a phone whose clock is a day out still opens on the site's today", async ({ page }) => {
  // THE FAILURE THIS WHOLE CHANGE EXISTS FOR, driven with a real wrong clock
  // rather than argued about. Every present-tense claim the app makes was
  // device-clock arithmetic against naive site-local strings: which date is
  // "today", whether you are "In" or "On lunch", and a live total that clamps
  // a negative to zero — so a phone running behind showed 0m worked to
  // somebody standing at the machine.
  //
  // A traveller's phone, one that lost NTP, one set by hand: all the same
  // shape. Here it believes it is tomorrow.
  const site = new Date();
  const deviceBelieves = new Date(site.getTime() + 24 * 60 * 60 * 1000);
  await page.clock.install({ time: deviceBelieves });

  // A request LISTENER, not a route: routes are matched last-registered-first,
  // so a handler installed here is shadowed by openMiniApp's own and never
  // runs. The event fires for every request whoever fulfils it.
  const asked: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("get_my_calendar")) return;
    const body = request.postData();
    if (body) asked.push((JSON.parse(body) as { start_date: string }).start_date);
  });
  await openMiniApp(page, { punched: "full", serverNow: site });

  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // The heading names the site's day, not the device's.
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText("Today");

  // And it SETTLES on the site's day. The very first request is necessarily
  // the device's — nothing has told the app the time yet, because the answer
  // arrives in the reply to that request — so the honest assertion is about
  // where it ends up, not about never having asked. That first range is the
  // whole residual: one extra query, corrected within the round trip.
  await expect.poll(() => asked.at(-1)).toBe(key(site));
  expect(
    asked.filter((d) => d === key(deviceBelieves)).length,
    "the device's day should be asked for at most once, on the launch request",
  ).toBeLessThanOrEqual(1);

  // The rendered day is the site's, which is what the employee actually reads.
  await expect(heading).toContainText(
    site.toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
  );
});

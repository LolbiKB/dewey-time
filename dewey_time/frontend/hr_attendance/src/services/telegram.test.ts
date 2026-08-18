import assert from "node:assert/strict";
import test from "node:test";

import { createLinkInvite, revokeLink } from "@/services/telegram";

type Recorded = { url: string; init: RequestInit };

/** Swap globalThis.fetch for a recorder — the same shape frappe.test.ts uses. */
function stubFetch(body: unknown) {
  const calls: Recorded[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ message: body }) };
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** The SPA reads window.csrf_token; node has no window. */
function stubWindow(csrf: string) {
  const g = globalThis as Record<string, unknown>;
  const original = g.window;
  g.window = { csrf_token: csrf };
  return () => { g.window = original; };
}

const INVITE = {
  employee: "HR-EMP-00001",
  url: "https://t.me/bot?start=tok",
  expires_at: "2026-08-19 09:00:00",
  expires_in_seconds: 86_400,
};

test("issuing a link is a POST, and the employee never reaches the query string", async () => {
  // The response body IS a credential: whoever opens the URL binds their
  // Telegram account to this employee's record. A GET would put the employee
  // id into every access log, proxy log and browser history entry between the
  // browser and the bench — and the Python whitelist pins methods=["POST"], so
  // a GET here would also simply 405 in production while passing any test that
  // only checked the returned value.
  const fetchStub = stubFetch(INVITE);
  const restoreWindow = stubWindow("csrf-123");
  try {
    await createLinkInvite("HR-EMP-00001");
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(fetchStub.calls[0].init.method, "POST");
    assert.doesNotMatch(fetchStub.calls[0].url, /\?/, "no query string at all");
    assert.doesNotMatch(fetchStub.calls[0].url, /HR-EMP-00001/);
  } finally {
    fetchStub.restore();
    restoreWindow();
  }
});

test("the employee travels in the body, and the method path is the whitelisted one", () => {
  const fetchStub = stubFetch(INVITE);
  const restoreWindow = stubWindow("csrf-123");
  return createLinkInvite("HR-EMP-00042")
    .then(() => {
      const { url, init } = fetchStub.calls[0];
      assert.equal(url, "/api/method/dewey_time.telegram.binding.create_link_invite");
      assert.deepEqual(JSON.parse(String(init.body)), { employee: "HR-EMP-00042" });
    })
    .finally(() => {
      fetchStub.restore();
      restoreWindow();
    });
});

test("the invite is unwrapped from Frappe's message envelope", async () => {
  // frappeCall returns body.message. Returning the envelope instead would put
  // `{message: {...}}` into the dialog, which renders as a blank link box.
  const fetchStub = stubFetch(INVITE);
  const restoreWindow = stubWindow("csrf-123");
  try {
    assert.deepEqual(await createLinkInvite("HR-EMP-00001"), INVITE);
  } finally {
    fetchStub.restore();
    restoreWindow();
  }
});

test("unlinking is a POST too, so it never lands in a URL or an access log", async () => {
  // Same reason as issuing: the employee id names whose access is being
  // destroyed, and a GET would leave it in every proxy log and browser history
  // entry between here and the bench. The Python whitelist pins
  // methods=["POST"], so a GET would also 405 in production while passing any
  // test that only checked the returned value.
  const fetchStub = stubFetch({ employee: "HR-EMP-00001", unlinked: 1, tokens_revoked: 2 });
  const restoreWindow = stubWindow("csrf-123");
  try {
    const result = await revokeLink("HR-EMP-00001");
    assert.equal(result.unlinked, 1);
    assert.equal(result.tokens_revoked, 2);
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(fetchStub.calls[0].init.method, "POST");
    assert.equal(
      fetchStub.calls[0].url,
      "/api/method/dewey_time.telegram.binding.revoke_link",
    );
    assert.doesNotMatch(fetchStub.calls[0].url, /HR-EMP-00001/);
    assert.deepEqual(JSON.parse(String(fetchStub.calls[0].init.body)), {
      employee: "HR-EMP-00001",
    });
  } finally {
    fetchStub.restore();
    restoreWindow();
  }
});

test("the invite carries a duration, not only a datetime string", async () => {
  // `expires_at` is naive site-local. A browser cannot turn that into an
  // instant without knowing the site's timezone, so a countdown driven from it
  // is wrong by whatever the two differ by. The duration is what the dialog
  // actually counts down.
  const fetchStub = stubFetch(INVITE);
  const restoreWindow = stubWindow("csrf-123");
  try {
    const invite = await createLinkInvite("HR-EMP-00001");
    assert.equal(invite.expires_in_seconds, 86_400);
  } finally {
    fetchStub.restore();
    restoreWindow();
  }
});

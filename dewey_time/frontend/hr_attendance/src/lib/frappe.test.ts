import assert from "node:assert/strict";
import test from "node:test";

import { frappeCall, FrappeCallError } from "@/lib/frappe";

type Recorded = { url: string; init: RequestInit };

/** Swap globalThis.fetch for a recorder. Returns the log and a restore fn. */
function stubFetch(response: { ok: boolean; status: number; body: unknown }) {
  const calls: Recorded[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    };
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** The SPA reads window.csrf_token; node has no window. */
function stubWindow(csrf: string) {
  const g = globalThis as Record<string, unknown>;
  const original = g.window;
  g.window = { csrf_token: csrf };
  return () => {
    g.window = original;
  };
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

test("frappeCall sends the CSRF token on POST", async () => {
  const restoreWindow = stubWindow("tok-123");
  const { calls, restore } = stubFetch({ ok: true, status: 200, body: { message: 1 } });
  try {
    await frappeCall("dewey_time.x.write", { a: 1 }, { method: "POST" });
    assert.equal(headerOf(calls[0]!.init, "X-Frappe-CSRF-Token"), "tok-123");
    assert.equal(calls[0]!.init.body, JSON.stringify({ a: 1 }));
  } finally {
    restore();
    restoreWindow();
  }
});

test("frappeCall does NOT send a CSRF token on GET", async () => {
  const restoreWindow = stubWindow("tok-123");
  const { calls, restore } = stubFetch({ ok: true, status: 200, body: { message: 1 } });
  try {
    await frappeCall("dewey_time.x.read");
    assert.equal(headerOf(calls[0]!.init, "X-Frappe-CSRF-Token"), undefined);
  } finally {
    restore();
    restoreWindow();
  }
});

test("frappeCall unwraps the {message} envelope", async () => {
  const restoreWindow = stubWindow("");
  const { restore } = stubFetch({
    ok: true,
    status: 200,
    body: { message: { employees: [{ id: "EMP-1" }] } },
  });
  try {
    const result = await frappeCall<{ employees: Array<{ id: string }> }>("dewey_time.x.read");
    assert.deepEqual(result, { employees: [{ id: "EMP-1" }] });
  } finally {
    restore();
    restoreWindow();
  }
});

test("frappeCall serialises GET params into the query string", async () => {
  const restoreWindow = stubWindow("");
  const { calls, restore } = stubFetch({ ok: true, status: 200, body: { message: null } });
  try {
    await frappeCall("dewey_time.x.read", { employee: "EMP-1", start_date: "2026-07-01" });
    assert.ok(calls[0]!.url.includes("employee=EMP-1"));
    assert.ok(calls[0]!.url.includes("start_date=2026-07-01"));
  } finally {
    restore();
    restoreWindow();
  }
});

test("frappeCall throws FrappeCallError carrying the server message", async () => {
  const restoreWindow = stubWindow("");
  const { restore } = stubFetch({
    ok: false,
    status: 417,
    body: {
      message: "There was an error.",
      _server_messages: JSON.stringify([JSON.stringify({ message: "Employee is not eligible." })]),
    },
  });
  try {
    await assert.rejects(
      () => frappeCall("dewey_time.x.write", undefined, { method: "POST" }),
      (err: unknown) => {
        assert.ok(err instanceof FrappeCallError);
        assert.equal(err.message, "Employee is not eligible.");
        assert.equal(err.status, 417);
        assert.equal(err.method, "dewey_time.x.write");
        return true;
      },
    );
  } finally {
    restore();
    restoreWindow();
  }
});

test("frappeCall throws FrappeCallError when the response has no {message} envelope", async () => {
  const restoreWindow = stubWindow("");
  // A 204, or a session-expiry HTML page served with 200: res.json() rejects and
  // the transport's own .catch() hands the success path exactly this null. That
  // path must not destructure it — callers catch FrappeCallError, not TypeError.
  const { restore } = stubFetch({ ok: true, status: 200, body: null });
  try {
    await assert.rejects(
      () => frappeCall("dewey_time.x.read"),
      (err: unknown) => {
        assert.ok(err instanceof FrappeCallError);
        assert.equal(err.status, 200);
        assert.equal(err.method, "dewey_time.x.read");
        return true;
      },
    );
  } finally {
    restore();
    restoreWindow();
  }
});

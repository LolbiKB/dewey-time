# HR SPA → ADMS Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the HR SPA's chrome, data layer, and robustness to ADMS parity across all four routes, without altering the attendance domain views.

**Architecture:** A new Frappe transport (`lib/frappe.ts`) generalises the pattern already proven in `pwa/push.ts`, and feeds react-query through a hierarchical key registry whose prefix structure makes cache invalidation correct by construction. Routes are then converted one at a time — data layer, chrome, and feedback together in a single pass per route — so each page file is opened once and reaches its final state before the next begins.

**Tech Stack:** React 19, TypeScript, Vite, TailwindCSS v4, `@tanstack/react-query` v5, `@lolbikb/dewey-ui` v1.11.0, shadcn registry (`new-york`), `tsx --test` (node test runner), Playwright.

## Global Constraints

- **Sourcing rule, in strict order:** `@lolbikb/dewey-ui` export → shadcn registry (`npx shadcn@latest add <name>`) → hand-roll only with a comment stating why neither fit.
- **dewey-ui provides** `Page`, `PageHeader`, `Section`, `EmptyState`, `Breadcrumb*`, `GenericDataTable`. It has **no** `Alert`, `Spinner`, `Field`, or `Item` — those come from shadcn.
- **The domain layer is not touched.** `DayTimeline`, `WeekView`, `WeekDayView`, `DayChips`, `WeekScheduleGantt`, `WeekPatternGroupEditor`, `DayInspectorSheet`, `FlagDetailPanel`, `WeekFlagSummary`, `EmployeeAvatar`, `MobileTabBar`, every domain module in `lib/` (`attendancePunches`, `clockDay`, `weekCalendar`, `shiftTimeline`, `lunchDetection`, `scheduleCoverage`), and all of `brand/` keep their exact current markup and classes.
- **Domain empty states stay hand-rolled.** `WeekPatternGroupEditor.tsx:97` and `WeekScheduleGantt.tsx:196` are domain visuals and are **not** converted to `EmptyState`. Only the four generic ones are.
- **The test runner stays `tsx --test`.** Do not introduce vitest. New test files must match the existing `test:web` globs (`src/lib/*.test.ts`, `src/ui/*.test.tsx`, `src/components/*.test.tsx`) so they are picked up without a package.json script change.
- **The full existing suite must stay green at every commit:** `npm run test:web` (197 tests) and `npm run test:e2e` (18 tests). No existing test may be edited in the same commit as the code it covers.
- **Never edit a test to make it pass.** If an existing test fails, the change is wrong until proven otherwise. Report it rather than adjusting the assertion.
- **Every command runs from `dewey_time/frontend/hr_attendance/`** unless stated otherwise.
- **`window.csrf_token`** is already injected by `www/hr-attendance.html:23` and `www/hr-schedule.html:23`. No server-side change is needed anywhere in this plan.
- **Do not run `npm install` for new packages yourself if you are a subagent** — the single dependency addition is called out in Task 1 Step 1 and is the controller's to run. Report if it is missing rather than installing it.
- **Git discipline:** `git add` only the named files. Never `git add -A`, `.`, or `-u`. Never checkout/switch/branch/stash/reset/rebase/merge/clean/push.
- **`npm run build` is a verification step, never a deliverable.** It rewrites seven *tracked* files — `dewey_time/public/hr_attendance/{index.html,assets/index.js,assets/index.js.map,assets/index.css,assets/build-id.txt}` and `dewey_time/www/{hr-attendance.html,hr-schedule.html}`. **Never commit them.** The last two frontend PRs (#65, #68) did not; assets were last committed in `11f8ac70` (#58) and are rebuilt at deploy time. Leave them dirty and say so in your report — the controller restores them before generating the review package.
- **Commit message trailers**, on every commit:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC
  ```

## A note on code verbatimness in this plan

Tasks 1, 2, and 7 contain the complete literal code to write — they are new, small, and precise.

Tasks 3–6 are mechanical conversions of ~1,400 lines of existing hooks. Transcribing all of it here would produce a plan nobody reads. Instead each of those tasks gives: the exact before/after **contract** for every hook (so callers do not change shape), the exact query key and HTTP verb for every method, **one fully worked conversion written out verbatim**, and the exact line ranges for every chrome edit. The remaining conversions in a task are mechanically identical to the worked one. If a conversion is *not* mechanically identical, stop and report it — that is a finding, not something to improvise through.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `src/lib/frappe.ts` | The only place that talks to `/api/method/`. CSRF, envelope unwrapping, error extraction. |
| `src/lib/frappe.test.ts` | Transport contract: CSRF on POST only, unwrap, error extraction. |
| `src/lib/queryKeys.ts` | Hierarchical array-key registry. The single source of cache identity. |
| `src/lib/queryKeys.test.ts` | Asserts the prefix property that invalidation depends on. |
| `src/lib/queryClient.ts` | QueryClient config — ADMS's freshness strategy, deliberately divergent retry. |
| `src/lib/toast.ts` | `notifySuccess`/`notifyError`/… helpers over sonner. |
| `src/services/calendar.ts` | `list_calendar_employees`, `get_employee_calendar`, `get_calendar_session`. |
| `src/services/schedule.ts` | The five `schedule_api.*` methods. |
| `src/services/coverage.ts` | `get_schedule_coverage`. |
| `src/services/maintenance.ts` | All seven `dev_tools.*` methods — three preview/clear pairs plus `run_engine_for_employee`. |
| `src/components/error-boundary.tsx` | Root render-error boundary. |
| `src/components/error-boundary.test.tsx` | `getDerivedStateFromError` contract. |
| `src/components/ui/{alert,spinner,field,item}.tsx` | shadcn additions (new-york). |
| `src/components/ui/breadcrumb.tsx` | dewey-ui re-export shim. |
| `src/ui/chromeMigration.test.tsx` | Source pins: `<Page>` per route, no manual-refetch counters. |

**Modified files:** `components.json`, `package.json`, `src/main.tsx`, `src/ui/HrAppShell.tsx`, the four page components, and the 13 files in `src/hooks/`.

---

### Task 1: Data foundation — transport, keys, client

**Files:**
- Create: `src/lib/frappe.ts`, `src/lib/frappe.test.ts`, `src/lib/queryKeys.ts`, `src/lib/queryKeys.test.ts`, `src/lib/queryClient.ts`
- Modify: `package.json`, `src/main.tsx`

**Interfaces:**
- Consumes: `extractFrappeError(err: unknown, fallback?: string): string` from `@/lib/frappeError`.
- Produces:
  - `frappeCall<T>(method: string, params?: Record<string, unknown>, opts?: { method?: "GET" | "POST" }): Promise<T>`
  - `class FrappeCallError extends Error` with `.status: number` and `.method: string`
  - `queryKeys` — the registry object, shape given in Step 6
  - `queryClient` — a configured `QueryClient` instance

No route is migrated in this task. Both providers end the task mounted side by side; that is intentional and is what makes Tasks 3–6 independently shippable.

- [ ] **Step 1: Add the dependency** *(controller runs this, not a subagent)*

```bash
npm install @tanstack/react-query@^5.90.20
```

Expected: `package.json` gains `"@tanstack/react-query": "^5.90.20"` under `dependencies`. Do not add `@tanstack/react-query-devtools` — it is a devDependency in ADMS and is not needed here.

- [ ] **Step 2: Write the failing transport test**

Create `src/lib/frappe.test.ts`:

```ts
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
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** The SPA reads window.csrf_token; node has no window. */
function stubWindow(csrf: string) {
  const g = globalThis as Record<string, unknown>;
  const original = g.window;
  g.window = { csrf_token: csrf };
  return () => { g.window = original; };
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
        return true;
      },
    );
  } finally {
    restore();
    restoreWindow();
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test src/lib/frappe.test.ts`
Expected: FAIL — cannot resolve `@/lib/frappe`.

- [ ] **Step 4: Write the transport**

Create `src/lib/frappe.ts`:

```ts
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

  return (body as { message: T }).message;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --test src/lib/frappe.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Write the failing key-registry test**

Create `src/lib/queryKeys.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { queryKeys } from "@/lib/queryKeys";

/** react-query invalidates by prefix — this is the exact match it performs. */
function hasPrefix(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.length <= key.length && prefix.every((part, i) => key[i] === part);
}

// Walks the WHOLE registry rather than naming families, so it stays correct as
// later tasks add keys and needs no per-family edit. Two hand-written family
// tests were the original design; they left 5 of 9 builders unasserted, which
// the Task 1 review caught.
test("every key builder carries its family prefix", () => {
  for (const [family, members] of Object.entries(queryKeys)) {
    const { all, ...builders } = members as { all: readonly unknown[] } & Record<string, unknown>;
    for (const [name, build] of Object.entries(builders)) {
      if (typeof build !== "function") continue;
      const key = (build as (...a: unknown[]) => readonly unknown[])(
        ...Array.from({ length: build.length }, (_, i) => `arg${i}`),
      );
      assert.ok(hasPrefix(key, all), `${family}.${name} escapes its family`);
    }
  }
});

// Without this, the tests above would pass for a registry where every key is
// identical — the prefix property only means something if families are disjoint.
test("families do not invalidate each other", () => {
  assert.ok(!hasPrefix(queryKeys.calendar.employee("EMP-1", "a", "b"), queryKeys.schedule.all));
  assert.ok(!hasPrefix(queryKeys.schedule.context("EMP-1"), queryKeys.calendar.all));
  assert.ok(!hasPrefix(queryKeys.coverage.all, queryKeys.schedule.all));
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx tsx --test src/lib/queryKeys.test.ts`
Expected: FAIL — cannot resolve `@/lib/queryKeys`.

- [ ] **Step 8: Write the key registry**

Create `src/lib/queryKeys.ts`:

```ts
/**
 * Centralised query-key registry. Every cache key in the app is built here.
 *
 * Keys are hierarchical so invalidation works by prefix: invalidating
 * `queryKeys.schedule.all` reaches context, resolve, templates and holidays
 * without naming them. That property is what makes cache correctness
 * structural rather than a matter of remembering — it is asserted in
 * queryKeys.test.ts, so adding a key outside its family will fail the suite.
 */
export const queryKeys = {
  session: {
    all: ["session"] as const,
  },

  employees: {
    all: ["employees"] as const,
    list: () => [...queryKeys.employees.all, "list"] as const,
  },

  calendar: {
    all: ["calendar"] as const,
    employee: (employee: string, startDate: string, endDate: string) =>
      [...queryKeys.calendar.all, "employee", employee, startDate, endDate] as const,
  },

  schedule: {
    all: ["schedule"] as const,
    context: (employee: string) => [...queryKeys.schedule.all, "context", employee] as const,
    resolve: (employee: string, effectiveFrom: string, patternJson: string) =>
      [...queryKeys.schedule.all, "resolve", employee, effectiveFrom, patternJson] as const,
    templates: (limit: number) => [...queryKeys.schedule.all, "templates", limit] as const,
    holidays: (employee: string, startDate: string, endDate: string) =>
      [...queryKeys.schedule.all, "holidays", employee, startDate, endDate] as const,
  },

  coverage: {
    all: ["coverage"] as const,
  },

  maintenance: {
    all: ["maintenance"] as const,
    employeeClearPreview: (employee: string) =>
      [...queryKeys.maintenance.all, "employee-clear-preview", employee] as const,
    allClearPreview: () => [...queryKeys.maintenance.all, "all-clear-preview"] as const,
    siteClearPreview: () => [...queryKeys.maintenance.all, "site-clear-preview"] as const,
  },
} as const;
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx tsx --test src/lib/queryKeys.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 10: Write the query client**

Create `src/lib/queryClient.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";

import { FrappeCallError } from "@/lib/frappe";

/**
 * Follows ADMS's freshness strategy (frontend/adms/src/App.tsx:27-46): data is
 * stale immediately (always revalidate on mount) but stays cached for 5
 * minutes, and refetches when the user returns to the tab or the network
 * reconnects.
 *
 * Deliberately diverges from ADMS on retry — see the comments below.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 1000 * 60 * 5,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // 4xx is the server's verdict, not a blip: a 403 session-expiry or a 417
      // frappe.throw() is re-issued pointlessly and delays the message the user
      // needs. FrappeCallError.status exists to discriminate exactly this.
      retry: (count, err) =>
        !(err instanceof FrappeCallError && err.status >= 400 && err.status < 500) && count < 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Deliberately NOT ADMS's retry:1. Our mutations create Shift Assignments
      // and delete schedules; a retry after a commit-then-drop duplicates them.
      // This is react-query's own default.
      retry: false,
      retryDelay: 1000,
    },
  },
});
```

**This divergence from ADMS is human-approved** (Task 1 review, 2026-07-28). ADMS's mutations are device commands; ours create Shift Assignments and delete schedules, so `retry: 1` would duplicate a write that had already committed before the network dropped. Do not "restore parity" here in a later task.

- [ ] **Step 11: Mount the provider alongside the existing one**

In `src/main.tsx`, add these two imports beside the existing ones:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
```

Then wrap `<FrappeProvider>` — the new provider goes **outside**, so it survives FrappeProvider's removal in Task 7:

```tsx
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <FrappeProvider enableSocket={false}>
        <TooltipProvider>
```

and close it correspondingly:

```tsx
        </TooltipProvider>
      </FrappeProvider>
    </QueryClientProvider>
  </React.StrictMode>
```

- [ ] **Step 12: Run the full suite and typecheck**

Run: `npm run test:web && npx tsc --noEmit`
Expected: 197 existing + 8 new = 205 tests pass. `tsc` reports only the pre-existing TS5101 warning; no new errors.

- [ ] **Step 13: Verify the app still boots**

Run: `npm run build`
Expected: build succeeds. Nothing rendered has changed — this step catches a broken provider nesting before it reaches a route task.

- [ ] **Step 14: Commit**

```bash
git add package.json package-lock.json src/lib/frappe.ts src/lib/frappe.test.ts src/lib/queryKeys.ts src/lib/queryKeys.test.ts src/lib/queryClient.ts src/main.tsx
git commit -m "feat(hr-web): react-query foundation — transport, key registry, client

lib/frappe.ts generalises the transport already proven in pwa/push.ts, adding
GET support and real _server_messages error extraction. lib/queryKeys.ts makes
cache invalidation structural: a test asserts every key carries its family
prefix, so a key added outside its family fails the suite.

No route migrated yet; both providers are mounted side by side.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC"
```

---

### Task 2: Chrome and robustness foundation

**Files:**
- Modify: `components.json`, `src/main.tsx`, `src/ui/HrAppShell.tsx`
- Create: `src/components/error-boundary.tsx`, `src/components/error-boundary.test.tsx`, `src/lib/toast.ts`, `src/components/ui/breadcrumb.tsx`, and the shadcn additions
- Reference: `frontend/adms/src/components/error-boundary.tsx`, `frontend/adms/src/lib/toast.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `ErrorBoundary` — a class component wrapping `children`
  - `notifySuccess(title, description?, options?)`, `notifyError(...)`, `notifyInfo(...)`, `notifyWarning(...)`, `notifyOperationFailed(action: string, error: unknown, options?)` from `@/lib/toast`
  - `Alert`, `AlertTitle`, `AlertDescription` from `@/components/ui/alert`
  - `Spinner` from `@/components/ui/spinner`
  - `Field`, `FieldLabel`, `FieldDescription` from `@/components/ui/field`
  - `Item`, `ItemContent`, `ItemTitle` from `@/components/ui/item`
  - `Breadcrumb*` from `@/components/ui/breadcrumb`

- [ ] **Step 1: Switch the shadcn style to new-york**

In `components.json`, change the `style` value:

```json
  "style": "new-york",
```

This governs newly-generated components only; it does not rewrite existing files. If the CLI in Step 2 rejects `new-york` as a style value, revert this line to `"radix-nova"`, note it in your report, and continue — dewey-ui's `theme.css` governs appearance either way, so only the generated source differs.

- [ ] **Step 2: Add the four shadcn components**

```bash
npx shadcn@latest add alert spinner field item
```

Expected: creates `src/components/ui/{alert,spinner,field,item}.tsx`. If the CLI offers to overwrite any existing file, decline — HR's other `components/ui/*` files are dewey-ui re-export shims and must not be replaced with local implementations.

- [ ] **Step 3: Add the breadcrumb re-export shim**

dewey-ui already exports these, so by the sourcing rule this is a shim, not an implementation. Create `src/components/ui/breadcrumb.tsx`:

```tsx
export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@lolbikb/dewey-ui"
```

- [ ] **Step 4: Write the failing error-boundary test**

Create `src/components/error-boundary.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";

import { ErrorBoundary } from "@/components/error-boundary";

// The boundary's whole job is the static reducer — a render throw must become
// state rather than an unmount. Testing it directly avoids needing a DOM.
test("getDerivedStateFromError captures the error into state", () => {
  const err = new Error("payload shape changed");
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(err), { error: err });
});

test("the boundary renders children when there is no error", () => {
  const instance = new ErrorBoundary({ children: "ok" });
  instance.state = { error: null };
  assert.equal(instance.render(), "ok");
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx tsx --test src/components/error-boundary.test.tsx`
Expected: FAIL — cannot resolve `@/components/error-boundary`.

- [ ] **Step 6: Write the error boundary**

Create `src/components/error-boundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Without it, a render-time throw anywhere in the
 * tree (e.g. an unexpected payload shape) unmounts the whole SPA to a blank
 * screen. This catches it and offers a reload, so one bad row can't
 * white-screen the app.
 *
 * Mirrors frontend/adms/src/components/error-boundary.tsx.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for diagnostics; the app keeps a usable fallback on screen.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center p-4">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">
              Dewey Time hit an unexpected error and couldn't render this view.
            </p>
            <p className="text-sm break-words text-muted-foreground">
              {this.state.error.message}
            </p>
            <Button onClick={this.handleReload} variant="outline">
              Reload
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx tsx --test src/components/error-boundary.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 8: Write the toast helpers**

Create `src/lib/toast.ts`:

```ts
/**
 * App notification helpers (Sonner). Mirrors frontend/adms/src/lib/toast.ts so
 * both apps report outcomes identically. `<Toaster />` is already mounted once
 * in main.tsx.
 *
 * Use these for mutation OUTCOMES (events). Persistent conditions — an
 * ineligible employee, "editing X's schedule" — stay inline as <Alert>, because
 * they remain true while the user reads them.
 */
import { toast, type ExternalToast } from "sonner";

export type ToastOptions = ExternalToast;

export { toast };

export function notifySuccess(title: string, description?: string, options?: ToastOptions) {
  if (description) return toast.success(title, { description, ...options });
  return toast.success(title, options);
}

export function notifyError(title: string, description?: string, options?: ToastOptions) {
  if (description) return toast.error(title, { description, ...options });
  return toast.error(title, options);
}

export function notifyInfo(title: string, description?: string, options?: ToastOptions) {
  if (description) return toast.info(title, { description, ...options });
  return toast.info(title, options);
}

export function notifyWarning(title: string, description?: string, options?: ToastOptions) {
  if (description) return toast.warning(title, { description, ...options });
  return toast.warning(title, options);
}

export function notifyOperationFailed(action: string, error: unknown, options?: ToastOptions) {
  const description = error instanceof Error ? error.message : String(error);
  return notifyError(`Failed to ${action}`, description, options);
}
```

- [ ] **Step 9: Mount the boundary**

In `src/main.tsx`, add the import:

```tsx
import { ErrorBoundary } from "@/components/error-boundary";
```

Wrap the tree **inside** `React.StrictMode` but **outside** `QueryClientProvider`, so a throw in provider setup is still caught:

```tsx
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
```

and close it after `</QueryClientProvider>`:

```tsx
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
```

- [ ] **Step 10: Add breadcrumbs to the shell**

In `src/ui/HrAppShell.tsx`, add this helper above `export function HrAppShell()`:

```tsx
function breadcrumbsFor(tab: AppTab, pathname: string, employee: string | null) {
  if (tab === "attendance") return [{ label: "Attendance" }];
  const schedule = { label: "Schedule", href: tabHref("schedule", employee) };
  if (pathname.startsWith("/hr-schedule/import")) {
    return [schedule, { label: "Import" }];
  }
  if (tab === "coverage") return [schedule, { label: "Coverage" }];
  return [{ label: "Schedule" }];
}
```

Then pass it to `AppShell`, immediately after the `linkComponent` prop:

```tsx
      linkComponent={RouterLink}
      breadcrumbs={breadcrumbsFor(tab, pathname, employee)}
```

- [ ] **Step 11: Run the full suite, typecheck, and build**

Run: `npm run test:web && npx tsc --noEmit && npm run build`
Expected: 205 existing + 2 new = 207 tests pass; no new `tsc` errors; build succeeds.

- [ ] **Step 12: Verify in a browser**

Run `npm run dev:hr` from `dewey_time/`, open `http://localhost:8080/hr-attendance`, and confirm: breadcrumbs render in the header on all four routes, and nothing else has visibly moved. Capture a screenshot of `/hr-attendance` at 1440×900 — it is the baseline Tasks 3–6 are compared against.

Reading the source is not sufficient here. A prior branch in this repo shipped a timeline colour bug that three review layers cleared from source and only a rendered page caught.

- [ ] **Step 13: Commit**

```bash
git add components.json src/components/error-boundary.tsx src/components/error-boundary.test.tsx src/components/ui/alert.tsx src/components/ui/spinner.tsx src/components/ui/field.tsx src/components/ui/item.tsx src/components/ui/breadcrumb.tsx src/lib/toast.ts src/main.tsx src/ui/HrAppShell.tsx
git commit -m "feat(hr-web): error boundary, toast helpers, breadcrumbs, shadcn primitives

The SPA had no error boundary — any render throw white-screened the whole app.
Adds ADMS's boundary, its notify* helpers, breadcrumbs in the shell, and the
four shadcn primitives dewey-ui does not export (alert, spinner, field, item).
shadcn style aligned to new-york to match ADMS.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC"
```

---

### Task 3: Convert `/hr-schedule`

The worst offender, and the proving ground for the transport. This task removes the `savedNonce` counter and all four `void refreshContext()` calls, and fixes the stale-calendar bug.

**Files:**
- Create: `src/services/schedule.ts`, `src/services/maintenance.ts`, `src/ui/chromeMigration.test.tsx`
- Modify: `src/hooks/useWeeklySchedule.ts`, `src/hooks/useClearEmployeeSchedule.ts`, `src/hooks/useClearAllSchedules.ts`, `src/hooks/useClearSitePatterns.ts`, `src/ui/WeeklySchedulePage.tsx`

**Interfaces:**
- Consumes: `frappeCall`, `FrappeCallError`, `queryKeys`, `notifySuccess`, `notifyOperationFailed`, `Alert`, `Spinner`, `Field`, `Item`, `EmptyState`, `Page`, `PageHeader`, `Section`.
- Produces: `src/services/schedule.ts` exporting `getScheduleContext`, `resolveSchedulePlan`, `getHolidayPreview`, `applyWeeklySchedule`, `listScheduleTemplates`; `src/services/maintenance.ts` exporting `previewClearEmployeeSchedule`, `clearEmployeeSchedule`, `previewClearAllSchedules`, `clearAllSchedules`, `previewClearSitePatterns`, `clearSitePatternsStep`.

**Hook contracts — these must not change.** Callers keep working unmodified:

| Hook | Returns (unchanged) |
|---|---|
| `useScheduleContext(employee)` | `{ context, error, isLoading, refresh }` |
| `useWeeklyScheduleResolve(employee, weekPattern, effectiveFrom)` | `{ plan, resolveError, resolving, validationIssues, patternValid, refreshPlan }` |
| `useApplyWeeklySchedule()` | `{ apply, applying, status, clearStatus }` |
| `useWeeklyScheduleTemplates(limit)` | `{ templates, isLoading }` |
| `useHolidayPreview(employee, start, end)` | `{ holidays, error, isLoading }` |

**Method → key → verb table for this task:**

| Method | Key | Verb |
|---|---|---|
| `schedule_api.get_employee_schedule_context` | `queryKeys.schedule.context(emp)` | GET |
| `schedule_api.resolve_weekly_schedule_plan` | `queryKeys.schedule.resolve(emp, from, patternJson)` | GET |
| `schedule_api.get_holiday_preview` | `queryKeys.schedule.holidays(emp, start, end)` | GET |
| `schedule_api.list_weekly_schedule_templates` | `queryKeys.schedule.templates(limit)` | GET |
| `schedule_api.apply_weekly_schedule` | mutation | POST |
| `dev_tools.preview_clear_employee_schedule_api` | `queryKeys.maintenance.employeeClearPreview(emp)` | POST |
| `dev_tools.clear_employee_schedule_api` | mutation | POST |
| `dev_tools.preview_clear_all_employee_schedules_api` | `queryKeys.maintenance.allClearPreview()` | POST |
| `dev_tools.clear_all_employee_schedules_api` | mutation | POST |
| `dev_tools.preview_clear_site_schedule_patterns_api` | `queryKeys.maintenance.siteClearPreview()` | POST |
| `dev_tools.clear_site_patterns_step_api` | mutation | POST |

- [ ] **Step 1: Write the service layer**

Create `src/services/schedule.ts`. These are plain async functions with no React — the whole point is that they are trivially readable and independently callable:

```ts
import { frappeCall } from "@/lib/frappe";
import type {
  ApplyScheduleResult,
  HolidayPreviewItem,
  ResolvePlan,
  ScheduleContext,
  WeeklyScheduleTemplate,
} from "@/types/schedule";

const NS = "dewey_time.attendance_engine.schedule_api";

export function getScheduleContext(employee: string) {
  return frappeCall<ScheduleContext>(`${NS}.get_employee_schedule_context`, { employee });
}

export function resolveSchedulePlan(args: {
  employee: string;
  effectiveFrom: string;
  weekPatternJson: string;
}) {
  return frappeCall<ResolvePlan>(`${NS}.resolve_weekly_schedule_plan`, {
    employee: args.employee,
    effective_from: args.effectiveFrom,
    week_pattern: args.weekPatternJson,
  });
}

export function getHolidayPreview(args: { employee: string; startDate: string; endDate: string }) {
  return frappeCall<{ holidays: HolidayPreviewItem[] }>(`${NS}.get_holiday_preview`, {
    employee: args.employee,
    start_date: args.startDate,
    end_date: args.endDate,
  });
}

export function listScheduleTemplates(limit: number) {
  return frappeCall<{ templates: WeeklyScheduleTemplate[] }>(
    `${NS}.list_weekly_schedule_templates`,
    { limit },
  );
}

export function applyWeeklySchedule(args: {
  employee: string;
  week_pattern: unknown;
  create_shifts_after: string;
  generate_through: string;
  confirm_create: boolean;
}) {
  return frappeCall<ApplyScheduleResult>(`${NS}.apply_weekly_schedule`, args, { method: "POST" });
}
```

Create `src/services/maintenance.ts` following the identical shape, with `const NS = "dewey_time.attendance_engine.dev_tools"` and every function using `{ method: "POST" }`. Read the current argument names off `src/hooks/useClearEmployeeSchedule.ts`, `useClearAllSchedules.ts`, and `useClearSitePatterns.ts` — pass them through unchanged.

Seven functions, not six. Alongside the three preview/clear pairs, add `runEngineForEmployee` — it lives in the same `dev_tools` namespace, and Task 6 consumes it:

```ts
export function runEngineForEmployee(args: {
  employee: string;
  start_date: string;
  end_date: string;
  mode: RunEngineMode;
}) {
  return frappeCall<RunEngineResponse>(`${NS}.run_engine_for_employee`, args, { method: "POST" });
}
```

Import `RunEngineMode` and `RunEngineResponse` from `@/hooks/useRunEngine`, which already exports both (lines 8 and 15). It is unused until Task 6 — that is expected, and `tsc` does not flag an unused export.

- [ ] **Step 2: Convert one hook, fully, as the pattern for the rest**

In `src/hooks/useWeeklySchedule.ts`, replace `useScheduleContext` with this. Every other read hook in this task follows the same shape — only the service function, key, and return-field names differ:

```ts
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queryKeys";
import { getScheduleContext } from "@/services/schedule";

export function useScheduleContext(employee: string | null) {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: employee ? queryKeys.schedule.context(employee) : queryKeys.schedule.all,
    queryFn: () => getScheduleContext(employee!),
    enabled: Boolean(employee),
  });

  return {
    context: data ?? null,
    error,
    isLoading,
    refresh: refetch,
  };
}
```

Note what disappeared: the `params` memo, the hand-built `swrKey` string, and the `data?.message` unwrapping (the transport does it now).

- [ ] **Step 3: Convert the remaining hooks in the four files**

Apply the Step 2 pattern to: `useWeeklyScheduleResolve`, `useHolidayPreview`, `useWeeklyScheduleTemplates` (in `useWeeklySchedule.ts`), and the preview reads in the three clear-dialog hooks. Preserve every return-field name from the contract table above.

Convert the writes with `useMutation`. `useApplyWeeklySchedule` keeps its `{ apply, applying, status, clearStatus }` shape; `applying` becomes `mutation.isPending`, and `status` stays the existing local error-state object so `WeeklySchedulePage`'s error rendering is untouched in this step.

If any hook resists this pattern — a debounce, a multi-step call, an ordering dependency — stop and report it rather than improvising. `useWeeklyScheduleResolve`'s debounce (`debouncedPatternJson`) is expected and stays as local state feeding the query key.

- [ ] **Step 4: Wire invalidation — and fix the stale-calendar bug**

Every mutation's `onSuccess` invalidates the families it affects. In `useApplyWeeklySchedule` and in all three clear hooks:

```ts
import { useQueryClient } from "@tanstack/react-query";

// inside the hook:
const queryClient = useQueryClient();

// in the mutation options:
onSuccess: () => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.schedule.all });
  // Clearing or re-applying a schedule changes what the attendance week shows.
  // Nothing invalidated this before — the calendar silently served stale data.
  void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.coverage.all });
},
```

- [ ] **Step 5: Delete the manual-refetch machinery**

In `src/ui/WeeklySchedulePage.tsx`, remove:
- the `savedNonce` state (line 88), its use in the effect dependency array (line 142), and its increment (line 240)
- all four `void refreshContext()` calls (lines 242, 356, 363, 370)

The effect at line 135-142 keeps `context?.employee` as its dependency. Re-seeding after a save now happens because `invalidateQueries` refetches the context and `context` changes identity — which is what `savedNonce` was faking.

- [ ] **Step 6: Run the suite — it must still pass before any chrome change**

Run: `npm run test:web && npm run test:e2e && npx tsc --noEmit`
Expected: 207 tests pass, 18 e2e pass, no new `tsc` errors. This is the gate proving the data-layer swap alone changed no behaviour. Do not proceed to Step 7 until it is green.

- [ ] **Step 7: Convert the page chrome**

In `src/ui/WeeklySchedulePage.tsx`, replace the hand-rolled container at lines 316-317:

```tsx
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-5 py-4 sm:px-8 sm:py-5">
```

with dewey-ui's, which owns page insets:

```tsx
      <Page>
```

Convert the `<header>` block (lines 318-377) to `<PageHeader title="Weekly Schedule" description="Configure shared shift patterns for an employee." actions={…} />`, moving the employee picker and the four dialog triggers into `actions`. Convert `<main>` (line 417) to `<Section grow>`, and the `<footer>` (line 493) stays a plain `<footer>` inside `<Page>`.

- [ ] **Step 8: Apply the primitive replacements**

| Location | Change |
|---|---|
| Lines 379-397 (`ineligibleMessage`, `isEditing` cards) | `<Card>` → `<Alert>`. These are persistent conditions and stay inline — do not convert to toasts. |
| Lines 399-414 (`saveSuccessUrl` card) | Delete; replaced by a toast in Step 9. |
| Lines 428-439 (`!scheduleEmployeeId` card) | → `<EmptyState title={…} description={…} />` from `@lolbikb/dewey-ui`. |
| `ClearEmployeeScheduleDialog.tsx:226` and `:250` (two dashed-border empty states) | → `<EmptyState>`. These are generic "nothing here" states, not domain visuals. Do **not** touch anything else in this file — `dialogMigration.test.tsx` asserts it contains `ResponsiveModal` and does **not** import from `@/components/ui/dialog`. |
| Lines 495-542 (effective-from / generate-through) | → shadcn `<Field>` / `<FieldLabel>` / `<FieldDescription>`. |
| Lines 650-662 (`pendingConfirmPlan` list) | → shadcn `<Item>` / `<ItemContent>` / `<ItemTitle>`. |
| Lines 561-565, 636-640 (`Loader2Icon className="… animate-spin"`) | → `<Spinner />`. |
| Line 709-716 (`role="alert"` error paragraph) | → `<Alert variant="destructive">`. |

- [ ] **Step 9: Replace the success banner with an actioned toast**

Delete the `saveSuccessUrl` state and its card. In `handleSave`, on `result.ok`:

```ts
      const url = result.attendance_url ?? `/hr-attendance?employee=${scheduleEmployeeId}`;
      const reconciled = result.reconciled;
      notifySuccess(
        reconciled &&
          (reconciled.inactivated_assignments.length || reconciled.trimmed_assignments.length)
          ? `Schedule updated — ${reconciled.inactivated_assignments.length} inactivated, ${reconciled.trimmed_assignments.length} trimmed.`
          : "Schedule saved successfully.",
        undefined,
        { action: { label: "Open attendance", onClick: () => navigate(url) } },
      );
```

The "Open attendance" link is preserved as a toast action — it must not be dropped.

- [ ] **Step 10: Write the chrome source pins**

Create `src/ui/chromeMigration.test.tsx`. Source-assertion tests over file text are an established idiom in this repo (`src/ui/clockDayGate.test.tsx`, `src/ui/dialogMigration.test.tsx`):

```tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`./${path}`, import.meta.url), "utf8");
}

test("WeeklySchedulePage uses dewey-ui's Page rather than a hand-rolled container", () => {
  const src = source("WeeklySchedulePage.tsx");
  assert.ok(src.includes("<Page>"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(
    !src.includes("max-w-7xl"),
    "hand-rolled max-w-7xl container should be gone — Page owns page insets",
  );
});

// savedNonce was a counter that faked a refetch because the mutation had no
// relationship to the read cache. invalidateQueries replaced it. If a counter
// like this reappears, the cache wiring has regressed.
test("WeeklySchedulePage has no manual-refetch counter", () => {
  const src = source("WeeklySchedulePage.tsx");
  assert.ok(!src.includes("savedNonce"), "savedNonce should be gone");
  assert.ok(!src.includes("refreshContext()"), "manual refreshContext() calls should be gone");
});
```

- [ ] **Step 11: Run the pins to verify they pass, then mutation-check one**

Run: `npx tsx --test src/ui/chromeMigration.test.tsx`
Expected: PASS — 2 tests.

Then prove the first pin is load-bearing: temporarily re-add `max-w-7xl` to any className in `WeeklySchedulePage.tsx`, re-run, and confirm **that specific test fails**. Revert. A pin that cannot fail is not a test.

- [ ] **Step 12: Run everything**

Run: `npm run test:web && npm run test:e2e && npx tsc --noEmit && npm run build`
Expected: 209 tests pass, 18 e2e pass, no new `tsc` errors, build succeeds.

- [ ] **Step 13: Verify in a browser**

`npm run dev:hr`, open `/hr-schedule`, and check against the Task 2 baseline screenshot: page insets look right, the employee picker and dialog triggers are in the header actions, saving shows a toast with a working "Open attendance" action, and the ineligible/editing banners still render inline. Screenshot at 1440×900 and 390×844 — `<Page>` changes insets, so the phone width is where a spacing regression will show.

- [ ] **Step 14: Commit**

```bash
git add src/services/schedule.ts src/services/maintenance.ts src/hooks/useWeeklySchedule.ts src/hooks/useClearEmployeeSchedule.ts src/hooks/useClearAllSchedules.ts src/hooks/useClearSitePatterns.ts src/ui/WeeklySchedulePage.tsx src/ui/ClearEmployeeScheduleDialog.tsx src/ui/chromeMigration.test.tsx
git commit -m "refactor(hr-web): convert /hr-schedule to react-query + dewey-ui chrome

Data layer, chrome and feedback converted in one pass. Deletes the savedNonce
counter and all four manual refreshContext() calls — invalidateQueries by key
prefix replaces them.

Fixes a real bug: clearing or re-applying a schedule now invalidates the
calendar and coverage caches too. Nothing did that before, so the attendance
week silently served stale data after a schedule change.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC"
```

---

### Task 4: Convert `/hr-schedule/import`

**Files:**
- Create: `src/services/scheduleImport.ts`
- Modify: `src/hooks/useScheduleImport.ts`, `src/hooks/useImportSchedulePlanSummary.ts`, `src/ui/schedule-import/ScheduleImportPage.tsx`, `src/ui/chromeMigration.test.tsx`

**Interfaces:**
- Consumes: everything Task 1 and Task 2 produced, plus the service-module shape established in Task 3.
- Produces: `src/services/scheduleImport.ts`.

The import wizard is stateful (upload → review → apply) and its hooks carry more local state than Task 3's. Convert reads to `useQuery` and the apply step to `useMutation` using the Task 3 Step 2 pattern; leave the wizard's step state exactly as it is.

- [ ] **Step 1: Write `src/services/scheduleImport.ts`**

Follow Task 3 Step 1's shape. Read the exact method names and argument names off `src/hooks/useScheduleImport.ts` and `src/hooks/useImportSchedulePlanSummary.ts` and pass them through unchanged.

- [ ] **Step 2: Convert the two hooks, preserving their public shape**

Record each hook's current return object before you change it, and return exactly the same field names afterwards. `ScheduleImportPage`, `UploadStep`, and `ReviewStep` must not need edits for the data-layer change.

- [ ] **Step 3: Wire invalidation**

The apply mutation's `onSuccess` invalidates `queryKeys.schedule.all`, `queryKeys.calendar.all`, and `queryKeys.coverage.all` — a bulk import changes all three.

- [ ] **Step 4: Run the suite before touching chrome**

Run: `npm run test:web && npm run test:e2e && npx tsc --noEmit`
Expected: 209 tests, 18 e2e, no new `tsc` errors. Do not proceed until green.

- [ ] **Step 5: Convert the page chrome**

In `ScheduleImportPage.tsx`: hand-rolled container → `<Page>`, page heading → `<PageHeader>`, body → `<Section grow>`. Replace `animate-spin` spinners with `<Spinner />`, status banners with `<Alert>`, and any generic empty state with `<EmptyState>`. `UploadStep.tsx` already uses sonner toasts — leave them.

- [ ] **Step 6: Add the source pin**

Append to `src/ui/chromeMigration.test.tsx`:

```tsx
test("ScheduleImportPage uses dewey-ui's Page", () => {
  const src = readFileSync(
    new URL("./schedule-import/ScheduleImportPage.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes("<Page>"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(!src.includes("max-w-7xl"), "hand-rolled container should be gone");
});
```

- [ ] **Step 7: Run everything**

Run: `npm run test:web && npm run test:e2e && npx tsc --noEmit && npm run build`
Expected: 210 tests, 18 e2e, no new `tsc` errors, build succeeds.

- [ ] **Step 8: Verify in a browser**

`npm run dev:hr`, walk the full import wizard at `/hr-schedule/import` — upload, review, apply. Confirm each step renders correctly and the applied result invalidates the schedule view. Screenshot at 1440×900 and 390×844.

- [ ] **Step 9: Commit**

```bash
git add src/services/scheduleImport.ts src/hooks/useScheduleImport.ts src/hooks/useImportSchedulePlanSummary.ts src/ui/schedule-import/ScheduleImportPage.tsx src/ui/chromeMigration.test.tsx
git commit -m "refactor(hr-web): convert /hr-schedule/import to react-query + dewey-ui chrome

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC"
```

---

### Task 5: Convert `/hr-schedule/coverage`

**Files:**
- Create: `src/services/coverage.ts`
- Modify: `src/hooks/useScheduleCoverage.ts`, `src/ui/schedule-coverage/ScheduleCoveragePage.tsx`, `src/ui/chromeMigration.test.tsx`

**Interfaces:**
- Consumes: as Task 4.
- Produces: `src/services/coverage.ts` exporting `getScheduleCoverage(): Promise<ScheduleCoveragePayload>`.

The smallest of the four routes — one read, no mutations.

- [ ] **Step 1: Write the service**

Create `src/services/coverage.ts`:

```ts
import { frappeCall } from "@/lib/frappe";
import type { ScheduleCoveragePayload } from "@/lib/scheduleCoverage";

export function getScheduleCoverage() {
  return frappeCall<ScheduleCoveragePayload>(
    "dewey_time.attendance_engine.coverage_api.get_schedule_coverage",
  );
}
```

- [ ] **Step 2: Convert the hook**

Rewrite `src/hooks/useScheduleCoverage.ts`'s body to use `useQuery` with `queryKey: queryKeys.coverage.all` and `queryFn: getScheduleCoverage`. The exported `ScheduleCoverage` type and every returned field (`unassigned`, `buckets`, `counts`, `isLoading`, `error`, `refresh`) stay exactly as they are — `bucketByWeeklyHours` and `EMPTY_COUNTS` keep their current roles.

- [ ] **Step 3: Run the suite before touching chrome**

Run: `npm run test:web && npm run test:e2e && npx tsc --noEmit`
Expected: 210 tests, 18 e2e, no new `tsc` errors.

- [ ] **Step 4: Convert the page chrome**

In `ScheduleCoveragePage.tsx`: container → `<Page>`, heading → `<PageHeader>`, body → `<Section grow>`, spinners → `<Spinner />`, generic empty states → `<EmptyState>`, error state → `<Alert variant="destructive">`. `EmployeeLine.tsx`, `HoursBuckets.tsx`, and `UnassignedList.tsx` are domain presentation — leave them.

- [ ] **Step 5: Add the source pin**

Append to `src/ui/chromeMigration.test.tsx`:

```tsx
test("ScheduleCoveragePage uses dewey-ui's Page", () => {
  const src = readFileSync(
    new URL("./schedule-coverage/ScheduleCoveragePage.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes("<Page>"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(!src.includes("max-w-7xl"), "hand-rolled container should be gone");
});
```

- [ ] **Step 6: Run everything**

Run: `npm run test:web && npm run test:e2e && npx tsc --noEmit && npm run build`
Expected: 211 tests, 18 e2e, no new `tsc` errors, build succeeds.

- [ ] **Step 7: Verify in a browser and commit**

`npm run dev:hr`, open `/hr-schedule/coverage`, screenshot at 1440×900 and 390×844, then:

```bash
git add src/services/coverage.ts src/hooks/useScheduleCoverage.ts src/ui/schedule-coverage/ScheduleCoveragePage.tsx src/ui/chromeMigration.test.tsx
git commit -m "refactor(hr-web): convert /hr-schedule/coverage to react-query + dewey-ui chrome

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC"
```

---

### Task 6: Convert `/hr-attendance`

The last and highest-risk route: it carries the week grid, the day timeline, and the mobile surfaces from PR #65.

**Files:**
- Create: `src/services/calendar.ts`
- Modify: `src/hooks/useHrAttendanceData.ts`, `src/hooks/useCalendarSession.ts`, `src/hooks/useRunEngine.ts`, `src/ui/App.tsx`, `src/ui/chromeMigration.test.tsx`

**Interfaces:**
- Consumes: as Task 5.
- Produces: `src/services/calendar.ts` exporting `listCalendarEmployees()`, `getEmployeeCalendar({ employee, startDate, endDate })`, `getCalendarSession()`.

**`App.tsx` already uses `<Page>` (line 1).** Its chrome work is therefore smaller than the other routes: `PageHeader`/`Section` adoption, and the primitive swaps.

**The domain components rendered by this page are out of scope** — `WeekView`, `WeekDayView`, `DayTimeline`, `DayChips`, `DayInspectorSheet`, `FlagDetailPanel`, `WeekFlagSummary`, `AttendanceToolbar`, `DeviceAlerts`. They keep their exact current markup. Only `App.tsx`'s own wrapper markup changes.

- [ ] **Step 1: Write the service**

Create `src/services/calendar.ts`:

```ts
import { frappeCall } from "@/lib/frappe";
import type { CalendarEmployee, CalendarPayload } from "@/types/calendar";
import type { CalendarSession } from "@/hooks/useCalendarSession";

const NS = "dewey_time.attendance_engine.hr_calendar";

export function listCalendarEmployees() {
  return frappeCall<{ employees: CalendarEmployee[]; current_user_employee: string | null }>(
    `${NS}.list_calendar_employees`,
  );
}

export function getEmployeeCalendar(args: {
  employee: string;
  startDate: string;
  endDate: string;
}) {
  return frappeCall<CalendarPayload>(`${NS}.get_employee_calendar`, {
    employee: args.employee,
    start_date: args.startDate,
    end_date: args.endDate,
  });
}

export function getCalendarSession() {
  return frappeCall<CalendarSession>(`${NS}.get_calendar_session`);
}
```

If `CalendarSession` is not currently exported from `useCalendarSession.ts`, export it there rather than redefining the type.

- [ ] **Step 2: Convert `useCalendarEmployees` and `useEmployeeCalendar`**

Apply the Task 3 Step 2 pattern. Keys: `queryKeys.employees.list()` and `queryKeys.calendar.employee(employee, startDate, endDate)`. `useEmployeeCalendar` keeps computing `rangeStart`/`rangeEnd` via `calendarFetchRange(anchor)` and keeps returning them — only the fetch changes.

The pure helpers in this file (`useDefaultEmployee`, `deviceAlertsForWeek`, `deviceAlertsByDate`, `deviceSyncByDate`, `formatDeviceAlertStatus`, `formatAttendanceLoadError`) are untouched.

- [ ] **Step 3: Convert `useCalendarSession` and `useRunEngine`**

`useCalendarSession` → `useQuery` with `queryKeys.session.all`, returning `{ hrStaff, isLoading }` unchanged — `HrAppShell` depends on that exact shape.

`useRunEngine` → `useMutation` over `runEngineForEmployee` from `@/services/maintenance` (added in Task 3 Step 1), keeping its `{ call, loading, reset }` shape — `RunEngineDialog` depends on those exact names. `loading` becomes `mutation.isPending`; `reset` becomes `mutation.reset`.

Its `onSuccess` invalidates `queryKeys.calendar.all` — re-running the engine rewrites flags, which is exactly what the week grid renders. `App.tsx:310`'s `onRunEngineSuccess={() => void refreshCalendar()}` becomes redundant once that invalidation is in place; remove the prop's manual refresh call and let the cache do it, keeping the prop itself if `RunEngineDialog` still needs a success signal for its own UI.

- [ ] **Step 4: Run the suite before touching chrome**

Run: `npm run test:web && npm run test:e2e && npx tsc --noEmit`
Expected: 211 tests, 18 e2e, no new `tsc` errors. This gate matters most here — the 18 e2e tests exercise this route heavily.

- [ ] **Step 5: Convert the page chrome**

In `src/ui/App.tsx`, keep the existing `<Page>`. Convert the heading block to `<PageHeader>`, the week-grid area to `<Section grow>`, the empty state at line 352 to `<EmptyState>`, and the `Loader2Icon animate-spin` occurrences to `<Spinner />`. `AttendanceLoading.tsx` gets its spinners swapped too — but its skeleton *shapes* are domain-tuned and stay.

Do not alter the clock-day gate at lines ~350: `selectedEmployee?.has_shift_assignment === false && !selectedEmployee?.is_clock_based`. It is pinned by `src/ui/clockDayGate.test.tsx`.

- [ ] **Step 6: Add the source pin**

Append to `src/ui/chromeMigration.test.tsx`:

```tsx
test("App uses PageHeader and Section inside Page", () => {
  const src = source("App.tsx");
  assert.ok(src.includes("<PageHeader"), "expected <PageHeader> from @lolbikb/dewey-ui");
  assert.ok(src.includes("<Section"), "expected <Section> from @lolbikb/dewey-ui");
});
```

- [ ] **Step 7: Run everything**

Run: `npm run test:web && npm run test:e2e && npx tsc --noEmit && npm run build`
Expected: 212 tests, 18 e2e, no new `tsc` errors, build succeeds.

- [ ] **Step 8: Verify in a browser — the most important verification in this plan**

`npm run dev:hr`, open `/hr-attendance`, and compare directly against the Task 2 baseline screenshot at 1440×900 and 390×844. Check specifically:

- week grid cells render with correct colours for a scheduled employee
- the day timeline renders segments in the worked tone, not the off-shift tone
- a clock-based employee's week renders neutral, not red
- the day inspector sheet opens and renders
- the mobile bottom tab bar still sits correctly at 390×844

A prior branch shipped a timeline colour regression that passed every source-level review and was caught only by rendering. Reading the diff is not sufficient.

- [ ] **Step 9: Commit**

```bash
git add src/services/calendar.ts src/hooks/useHrAttendanceData.ts src/hooks/useCalendarSession.ts src/hooks/useRunEngine.ts src/ui/App.tsx src/ui/AttendanceLoading.tsx src/ui/chromeMigration.test.tsx
git commit -m "refactor(hr-web): convert /hr-attendance to react-query + dewey-ui chrome

Last of the four routes. Domain components (WeekView, DayTimeline, DayChips,
DayInspectorSheet) untouched — only App.tsx's own wrapper markup changes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC"
```

---

### Task 7: Retire frappe-react-sdk

Sequenced last and alone because it touches the sign-in gate on all four routes.

**Files:**
- Create: `src/hooks/useSession.ts`
- Modify: `src/ui/App.tsx`, `src/ui/WeeklySchedulePage.tsx`, `src/main.tsx`, `package.json`
- Delete: nothing

**Interfaces:**
- Consumes: `frappeCall`, `queryKeys.session`.
- Produces: `useSession(): { currentUser: string | null; isLoading: boolean }` — the drop-in replacement for `useFrappeAuth()`'s `{ currentUser, isLoading: authLoading }`.

- [ ] **Step 1: Confirm nothing else imports the SDK**

Run: `grep -rn "frappe-react-sdk" src/`
Expected: exactly three files remain — `src/ui/App.tsx`, `src/ui/WeeklySchedulePage.tsx`, `src/main.tsx`. If anything else appears, a previous task left a hook unconverted. Stop and report rather than converting it here.

- [ ] **Step 2: Write the session hook**

Create `src/hooks/useSession.ts`:

```ts
import { useQuery } from "@tanstack/react-query";

import { frappeCall } from "@/lib/frappe";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Drop-in replacement for frappe-react-sdk's useFrappeAuth().
 *
 * Returns the logged-in user id, or null for an unauthenticated session. Guest
 * is normalised to "Guest" by Frappe itself, and callers already treat that as
 * signed-out (`!currentUser || currentUser === "Guest"`), so it is passed
 * through unchanged rather than mapped to null.
 */
export function useSession() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.session.all,
    queryFn: () => frappeCall<string>("frappe.auth.get_logged_user"),
    retry: false,
  });

  return { currentUser: data ?? null, isLoading };
}
```

`retry: false` is deliberate: an unauthenticated session returns 403, and retrying it twice with backoff would delay the sign-in card by seconds.

- [ ] **Step 3: Swap the two call sites**

In `src/ui/App.tsx` and `src/ui/WeeklySchedulePage.tsx`, replace:

```ts
import { useFrappeAuth } from "frappe-react-sdk";
const { currentUser, isLoading: authLoading } = useFrappeAuth();
```

with:

```ts
import { useSession } from "@/hooks/useSession";
const { currentUser, isLoading: authLoading } = useSession();
```

The gate conditions (`!currentUser || currentUser === "Guest"`) are unchanged.

- [ ] **Step 4: Verify the signed-out path in a browser BEFORE removing the provider**

`npm run dev:hr`, then in DevTools clear the site's cookies and reload `/hr-schedule`. Expected: the "Sign in required" card renders, with a working `/login?redirect-to=…` link — not a spinner, not a blank page, not an error boundary.

This is the one behaviour in this plan with no automated coverage, and it is the reason this task is sequenced alone. Do not proceed until it is confirmed by hand.

- [ ] **Step 5: Remove the provider and the dependency**

In `src/main.tsx`, delete the `FrappeProvider` import and unwrap it, leaving `QueryClientProvider` → `TooltipProvider`.

Then (controller runs this):

```bash
npm uninstall frappe-react-sdk
```

- [ ] **Step 6: Confirm the SDK is fully gone**

Run: `grep -rn "frappe-react-sdk" src/ package.json`
Expected: no matches.

- [ ] **Step 7: Run everything**

Run: `npm run test:web && npm run test:e2e && npx tsc --noEmit && npm run build`
Expected: 212 tests, 18 e2e, no new `tsc` errors, build succeeds.

- [ ] **Step 8: Verify all four routes signed in**

`npm run dev:hr`, visit all four routes signed in, and confirm each loads data. Then repeat the signed-out check from Step 4 on `/hr-attendance`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/hooks/useSession.ts src/ui/App.tsx src/ui/WeeklySchedulePage.tsx src/main.tsx
git commit -m "refactor(hr-web): retire frappe-react-sdk

useSession() over frappe.auth.get_logged_user replaces useFrappeAuth as a
drop-in; retry:false so an unauthenticated 403 shows the sign-in card
immediately instead of after two backoff retries. Signed-out path verified by
hand on /hr-schedule and /hr-attendance — it has no automated coverage, which
is why this change was sequenced alone.

The SPA now has one caching library, matching ADMS.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC"
```

---

## Verification summary

| After task | `test:web` | `test:e2e` | Browser check |
|---|---|---|---|
| 1 | 205 | 18 | build only |
| 2 | 207 | 18 | breadcrumbs; **capture the baseline screenshot** |
| 3 | 209 | 18 | `/hr-schedule` at 1440×900 + 390×844 |
| 4 | 210 | 18 | full import wizard walkthrough |
| 5 | 211 | 18 | `/hr-schedule/coverage` |
| 6 | 212 | 18 | `/hr-attendance` vs baseline — week grid, timeline tones, clock day, mobile tab bar |
| 7 | 212 | 18 | all four routes signed in **and signed out** |

Counts assume the current 197 passing tests. If the baseline differs, carry the delta forward rather than editing tests to hit these numbers.

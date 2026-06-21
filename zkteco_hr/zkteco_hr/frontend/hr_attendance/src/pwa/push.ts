// Web-push client: subscribe/unsubscribe, silent re-bind on login, and app-badge
// refresh. Talks to zkteco_hr.webpush.* whitelisted methods. The app injects
// window.csrf_token in the host page, so these imperative calls carry it.

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const csrf = (window as unknown as { csrf_token?: string }).csrf_token || "";
  const res = await fetch(`/api/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": csrf },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} failed (${res.status})`);
  const json = await res.json();
  return json.message as T;
}

export const getVapidPublicKey = () =>
  call<{ enabled: boolean; public_key: string }>("zkteco_hr.webpush.get_vapid_public_key");
export const savePushSubscription = (subscription: PushSubscriptionJSON) =>
  call("zkteco_hr.webpush.save_push_subscription", { subscription: JSON.stringify(subscription) });
export const deletePushSubscription = (endpoint: string) =>
  call("zkteco_hr.webpush.delete_push_subscription", { endpoint });
export const sendTestPush = () => call("zkteco_hr.webpush.send_test_push");
export const getBadgeCount = () => call<number>("zkteco_hr.webpush.get_my_badge_count");

export function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

// VAPID base64url → Uint8Array (applicationServerKey wants raw bytes).
function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const base = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function isPushEnabled(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  return !!(await reg.pushManager.getSubscription());
}

export async function enablePush(): Promise<void> {
  if (!isPushSupported()) throw new Error("This browser does not support push notifications.");
  const { enabled, public_key } = await getVapidPublicKey();
  if (!enabled || !public_key) throw new Error("Push isn't configured yet — ask an admin to enable it.");
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("Notification permission was denied.");
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
    }));
  await savePushSubscription(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await deletePushSubscription(sub.endpoint);
    await sub.unsubscribe();
  }
}

// Silent re-bind on login: re-owns the existing endpoint for whoever is now
// logged in (seamless re-auth + clean owner switch on a shared device).
export async function rebindPush(): Promise<void> {
  try {
    if (!isPushSupported() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await savePushSubscription(sub.toJSON());
  } catch {
    /* best-effort — never block the app on push (re)binding */
  }
}

// Refresh the app icon badge from the page (the SW also does this on push).
export async function refreshBadgeFromPage(): Promise<void> {
  try {
    const nav = navigator as unknown as {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;
    const count = Number(await getBadgeCount());
    if (count > 0) await nav.setAppBadge(count);
    else await nav.clearAppBadge?.();
  } catch {
    /* ignore */
  }
}

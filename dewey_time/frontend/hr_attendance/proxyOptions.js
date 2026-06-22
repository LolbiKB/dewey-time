/**
 * Vite dev proxy to a Frappe backend.
 *
 * Local bench (default): nothing to set — proxies to 127.0.0.1:8000.
 * No local bench (Frappe Cloud): point at the live site, e.g.
 *     FRAPPE_PROXY=https://dewey.frappehr.com npm run dev
 * then log in at http://localhost:8080/login (proxied). NOTE: this is LIVE
 * production data — reads are safe, but any writes hit prod.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function createProxyOptions(env = process.env) {
  const target =
    env.FRAPPE_PROXY || env.VITE_FRAPPE_PROXY || "http://127.0.0.1:8000";

  console.log(`[vite] Proxying Frappe requests → ${target}`);

  /** @type {import('vite').ProxyOptions} */
  const common = {
    target,
    changeOrigin: true,
    secure: target.startsWith("https"),
    ws: true,
    // Rewrite the session cookie's Domain to the dev host so login sticks when
    // proxying to a remote site (Frappe Cloud sets it for its own host).
    cookieDomainRewrite: "",
  };

  return {
    "^/(api|app|assets|files|private|login|socket.io)": common,
  };
}

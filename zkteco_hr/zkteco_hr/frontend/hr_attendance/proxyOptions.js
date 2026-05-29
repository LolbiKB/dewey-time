/** @param {Record<string, string | undefined>} [env] */
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
  };

  return {
    "^/(api|app|assets|files|private|login)": common,
  };
}

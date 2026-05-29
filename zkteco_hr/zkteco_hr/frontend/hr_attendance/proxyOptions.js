const target =
  process.env.FRAPPE_PROXY || process.env.VITE_FRAPPE_PROXY || "http://127.0.0.1:8000";

console.log(`[vite] Proxying Frappe requests → ${target}`);

/** @type {import('vite').ProxyOptions} */
const common = {
  target,
  changeOrigin: true,
  secure: target.startsWith("https"),
  ws: true,
};

export default {
  "^/(api|app|assets|files|private|login)": common,
};

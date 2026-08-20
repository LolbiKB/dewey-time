import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { createProxyOptions } from "./proxyOptions";
import { DEV_PORT } from "./devPort";

// Doppio-style: build into public/hr_attendance/, served at /assets/dewey_time/hr_attendance/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const proxy = command === "serve" ? createProxyOptions(env) : undefined;

  return {
    // Tailwind runs through the VITE plugin, not PostCSS. This is load-bearing,
    // not a preference: dewey-ui's theme.css @imports @fontsource-variable/geist
    // and kantumruy-pro, and @tailwindcss/postcss inlines those @font-face rules
    // without rebasing their `url(./files/*.woff2)` — which are relative to the
    // fontsource PACKAGE, not to src/index.css. Vite's asset pass then looked for
    // src/files/, found nothing, emitted no woff2 and rewrote no paths, and the
    // shipped CSS pointed at eight URLs that 503 in production. Silent in the
    // build log, in tsc and in the tests, because font-display:swap renders the
    // page in a fallback face rather than failing.
    //
    // @tailwindcss/vite participates in Vite's asset graph, so the files are
    // emitted and the URLs rewritten. The adms app in this repo was already
    // built this way and ships all of its fonts; this is that config, ported.
    // scripts/check-fonts.mjs fails the build if it ever regresses.
    plugins: [react(), tailwindcss()],
    base: command === "serve" ? "/" : "/assets/dewey_time/hr_attendance/",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server:
      command === "serve"
        ? {
            port: DEV_PORT,
            // Fail instead of sliding to 8081 on a conflict. A moved dev server
            // is invisible to Playwright, which keeps polling the port it was
            // told about — the silent half of issue #72.
            strictPort: true,
            host: true,
            proxy,
          }
        : undefined,
    build: {
      outDir: path.resolve(__dirname, "../../public/hr_attendance"),
      emptyOutDir: true,
      // No sourcemap: the 4.6MB map embedded the full annotated source, was
      // committed with the bundle, and /assets/ serves statically to anyone —
      // the login gate on the page does not extend to its assets.
      sourcemap: false,
      target: "es2015",
      rollupOptions: {
        output: {
          // Stable names for index.js/index.css only — the www pages and Desk
          // reference those two directly, with their own ?v= cache-buster.
          // Fonts and images are content-hashed: their URLs live inside
          // index.css where no ?v= reaches, so a stable-named font fix could
          // never replace a cached copy.
          entryFileNames: "assets/index.js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name ?? "";
            if (name.endsWith(".css")) return "assets/index.css";
            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
  };
});

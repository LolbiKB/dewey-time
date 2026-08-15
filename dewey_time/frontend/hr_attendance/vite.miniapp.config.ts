import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// A SECOND CONFIG, not a second entry in vite.config.ts. That file pins
// entryFileNames to "assets/index.js", and sync_hr_attendance_assets checks
// for that exact path, so adding an entry there would collide on the filename
// AND reach into the deploy path. A separate config sharing src/ and
// node_modules means @/ui/* imports resolve unchanged while this build emits
// its own, far smaller bundle — the Mini App must not ship the HR console.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/assets/dewey_time/miniapp/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../../public/miniapp"),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2015",
    rollupOptions: {
      input: path.resolve(__dirname, "index.miniapp.html"),
      output: {
        // Stable names, matching the other two bundles in this repo, so the
        // www page can reference the asset without parsing index.html.
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? "";
          if (name.endsWith(".css")) return "assets/index.css";
          return "assets/[name][extname]";
        },
      },
    },
  },
});

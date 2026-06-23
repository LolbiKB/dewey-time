import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createProxyOptions } from "./proxyOptions";

// Doppio-style: build into public/home/, served at /assets/dewey_time/home/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const proxy = command === "serve" ? createProxyOptions(env) : undefined;

  return {
    plugins: [react()],
    base: command === "serve" ? "/" : "/assets/dewey_time/home/",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server:
      command === "serve"
        ? {
            port: 8080,
            host: true,
            proxy,
          }
        : undefined,
    build: {
      outDir: path.resolve(__dirname, "../../public/home"),
      emptyOutDir: true,
      sourcemap: true,
      target: "es2015",
      rollupOptions: {
        output: {
          // Stable names so Desk page can load the same bundle without parsing index.html.
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
  };
});

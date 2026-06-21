/// <reference types="vitest/config" />
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { ViteMcp } from 'vite-plugin-mcp'
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // Frappe-hosted builds set VITE_BASE=/assets/zkteco_hr/adms/ (asset path);
  // standalone builds serve from the root.
  base: process.env.VITE_BASE ?? '/',
  // Frappe hosting needs stable bundle names (the www page references
  // assets/index.js|css directly; cache-busting is a ?v= query param) —
  // mirrors the zkteco_hr hr_attendance frontend contract.
  build:
    process.env.VITE_STABLE_ASSETS === '1'
      ? {
          rollupOptions: {
            output: {
              entryFileNames: 'assets/index.js',
              chunkFileNames: 'assets/[name].js',
              assetFileNames: (assetInfo: { name?: string }) => {
                const name = assetInfo.name ?? ''
                if (name.endsWith('.css')) return 'assets/index.css'
                return 'assets/[name][extname]'
              },
            },
          },
        }
      : undefined,
  plugins: [react(), tailwindcss(), ViteMcp()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Unit tests live under src/. Confine vitest there so it does not try to
  // collect the Playwright E2E specs in e2e/ (which use @playwright/test).
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  server: {
    proxy: {
      '/admin': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
      '/iclock': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
})

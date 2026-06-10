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
  plugins: [react(), tailwindcss(), ViteMcp()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
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

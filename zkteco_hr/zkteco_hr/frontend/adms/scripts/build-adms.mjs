#!/usr/bin/env node
/**
 * Build the dashboard in frappe auth mode and publish it into the zkteco_hr
 * Frappe app (served at https://<site>/adms).
 *
 *   ADMS_BRIDGE_URL=https://<cloud-run-host> node scripts/build-frappe.mjs
 *
 * Mirrors the zkteco_hr hr_attendance deploy contract (see that repo's
 * docs/HR_ATTENDANCE_DEPLOY.md): stable bundle names (assets/index.js|css),
 * assets/build-id.txt for the after_migrate sync, and a hand-written
 * www/adms.html with literal ?v=<timestamp> cache busting (no Jinja in asset
 * URLs). Output goes to ../zkteco_hr app public/adms/ + www/adms.html;
 * deploy by committing those in the zkteco_hr repo and pushing to the bench.
 */
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dashboardDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appDir = resolve(dashboardDir, '../..')

const bridgeUrl = process.env.ADMS_BRIDGE_URL
if (!bridgeUrl) {
  console.error('ADMS_BRIDGE_URL is required (the Cloud Run bridge URL the SPA should call)')
  process.exit(1)
}
if (!existsSync(appDir)) {
  console.error(`zkteco_hr app not found at ${appDir}`)
  process.exit(1)
}

const buildId = String(Date.now())

console.log('Building dashboard (frappe mode)…')
execSync('npx vite build', {
  cwd: dashboardDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_AUTH_MODE: 'frappe',
    VITE_BASE: '/assets/zkteco_hr/adms/',
    VITE_STABLE_ASSETS: '1',
    VITE_API_URL: bridgeUrl,
  },
})

writeFileSync(resolve(dashboardDir, 'dist/assets/build-id.txt'), buildId + '\n')

const publicDest = resolve(appDir, 'public/adms')
console.log(`Publishing bundle → ${publicDest}`)
rmSync(publicDest, { recursive: true, force: true })
mkdirSync(publicDest, { recursive: true })
cpSync(resolve(dashboardDir, 'dist'), publicDest, { recursive: true })
// The www page is the HTML entry; dist/index.html must not shadow it.
rmSync(resolve(publicDest, 'index.html'), { force: true })

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/assets/zkteco_hr/images/DI-logo.svg" />
    <title>ADMS Dashboard</title>
    <script>
      window.csrf_token = "{{ frappe.session.csrf_token }}";
    </script>
    <script type="module" crossorigin src="/assets/zkteco_hr/adms/assets/index.js?v=${buildId}"></script>
    <link rel="stylesheet" crossorigin href="/assets/zkteco_hr/adms/assets/index.css?v=${buildId}">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`
const wwwHtml = resolve(appDir, 'www/adms.html')
writeFileSync(wwwHtml, html)
console.log(`Wrote ${wwwHtml} (build ${buildId})`)
console.log('Done. Commit the zkteco_hr changes and deploy the bench.')

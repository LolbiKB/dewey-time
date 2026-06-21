import { Waypoints } from 'lucide-react'

/**
 * ADMS Bridge house mark — a green Waypoints glyph (two nodes bridged by a path:
 * the bridge between the ZKTeco devices and Frappe HR) + a two-weight wordtext:
 * "ADMS" leads in foreground, "Bridge" recedes in muted. The green lives in the
 * mark as identity — it is not a tinted surface. Sits at the left of the header
 * bar; AppShell links it to homeHref, so the text supplies the accessible name.
 */
export function Brandmark() {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <Waypoints className="size-4 text-primary" aria-hidden />
      <span className="text-sm font-semibold tracking-tight">
        <span className="text-foreground">ADMS</span>{' '}
        <span className="font-normal text-muted-foreground">Bridge</span>
      </span>
    </span>
  )
}

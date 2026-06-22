import { AdmsBridgeMark } from '@/brand/AdmsBridgeMark'

/**
 * ADMS Bridge header logo lockup — the self-drawing Waypoints house mark next to
 * the two-weight wordtext: "ADMS" leads in foreground, "Bridge" recedes in
 * muted. The green lives in the mark as identity. Hovering the lockup replays
 * the launch intro's pen-draw on the mark (the `.adms-lockup` hook drives the
 * CSS in brand-motion.css). AppShell links it to homeHref, so the text supplies
 * the accessible name. Single source of truth for the header logo.
 */
export function Brandmark() {
  return (
    <span className="adms-lockup inline-flex items-center gap-2 select-none">
      <AdmsBridgeMark className="size-4 shrink-0" />
      <span className="text-sm font-semibold tracking-tight">
        <span className="text-foreground">ADMS</span>{' '}
        <span className="font-normal text-muted-foreground">Bridge</span>
      </span>
    </span>
  )
}

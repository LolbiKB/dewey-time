/**
 * Signal system — the single source of truth for status COLOR in the dashboard.
 *
 * Color encodes MEANING, never decoration (Dewey design language):
 *   success   green   (--primary)          synced · online · approved · delivered
 *   attention orange  (--color-attention)  pending · warning · needs action
 *   danger    red     (--destructive)       failed · rejected · error · destructive
 *   progress  blue    (--color-progress)    syncing · in-progress (sanctioned hue)
 *   idle      gray    (--muted-foreground)  not-attempted · neutral · archived
 *
 * Surfaces stay NEUTRAL: signal color lives on text / icon / dot / border — never
 * as a fill on a card, tile, or row. Badges and alerts are signal elements by
 * nature, so a faint signal wash is allowed there (signalBadge / signalAlert).
 *
 * Every value is a STATIC class string so Tailwind can see and generate it. Map a
 * feature's domain state to a Signal, then pull the class — never write raw color
 * literals (text-green-700, bg-amber-50, …) anywhere else in the app.
 */
export type Signal = 'success' | 'attention' | 'danger' | 'progress' | 'idle'

export const SIGNALS: readonly Signal[] = [
  'success',
  'attention',
  'danger',
  'progress',
  'idle',
]

/** Foreground text / icon color. */
export const signalText: Record<Signal, string> = {
  success: 'text-primary',
  attention: 'text-attention',
  danger: 'text-destructive',
  progress: 'text-progress',
  idle: 'text-muted-foreground',
}

/** Solid dot / small status-indicator fill. */
export const signalDot: Record<Signal, string> = {
  success: 'bg-primary',
  attention: 'bg-attention',
  danger: 'bg-destructive',
  progress: 'bg-progress',
  idle: 'bg-muted-foreground',
}

/** Border color (e.g. a left accent on an otherwise-neutral tile). */
export const signalBorder: Record<Signal, string> = {
  success: 'border-primary',
  attention: 'border-attention',
  danger: 'border-destructive',
  progress: 'border-progress',
  idle: 'border-border',
}

/**
 * Status tile: a NEUTRAL surface (bg-card) with a colored left accent. Never
 * fills the surface with the signal color (neutral-substrate rule). Pair with
 * signalText/signalDot for the label/icon inside.
 */
export const signalTile: Record<Signal, string> = {
  success: 'border-l-2 border-l-primary bg-card',
  attention: 'border-l-2 border-l-attention bg-card',
  danger: 'border-l-2 border-l-destructive bg-card',
  progress: 'border-l-2 border-l-progress bg-card',
  idle: 'border-l-2 border-l-border bg-card',
}

/**
 * Badge: a faint signal tint + signal text. A badge is itself a signal, so the
 * subtle wash is allowed (unlike a card/row surface).
 */
export const signalBadge: Record<Signal, string> = {
  success: 'border-transparent bg-primary/10 text-primary',
  attention: 'border-transparent bg-attention/10 text-attention',
  danger: 'border-transparent bg-destructive/10 text-destructive',
  progress: 'border-transparent bg-progress/10 text-progress',
  idle: 'border-transparent bg-muted text-muted-foreground',
}

/**
 * Alert / callout banner: signal border + faint wash + signal text. For
 * inherently-signal messages (warnings, errors, confirmations), not surfaces.
 */
export const signalAlert: Record<Signal, string> = {
  success: 'border-primary/40 bg-primary/5 text-primary',
  attention: 'border-attention/40 bg-attention/5 text-attention',
  danger: 'border-destructive/40 bg-destructive/5 text-destructive',
  progress: 'border-progress/40 bg-progress/5 text-progress',
  idle: 'border-border bg-muted/40 text-muted-foreground',
}

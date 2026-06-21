/**
 * The Dewey Time dial — an inline, token-colored twin of the favicon clock mark
 * (public/images/dewey-time.svg). The favicon hardcodes hex for static <img>
 * use; this version rides --brand-primary / --brand-accent so it tracks the
 * green knob right alongside the wordmark. Same geometry, hands at 10:10.
 *
 * Decorative by default: aria-hidden, because the wordmark beside it in the
 * lockup already carries the accessible name.
 */
export function DeweyTimeMark({ className = "size-5 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 96 96" fill="none" aria-hidden focusable={false}>
      <circle cx="48" cy="48" r="32" fill="none" stroke="var(--brand-primary)" strokeWidth="8" />
      <line x1="48" y1="48" x2="35" y2="41" stroke="var(--brand-primary)" strokeWidth="8" strokeLinecap="round" />
      <line x1="48" y1="48" x2="66" y2="38" stroke="var(--brand-accent)" strokeWidth="8" strokeLinecap="round" />
      <circle cx="48" cy="48" r="4.5" fill="var(--brand-primary)" />
    </svg>
  );
}

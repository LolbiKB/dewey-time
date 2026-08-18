/**
 * Countdown formatting for a link that is a live credential.
 *
 * A pure function of one number, deliberately. The interval that produces the
 * number lives in the dialog; everything that decides what HR reads lives here,
 * where it is testable without timers, fake clocks or a rendered component.
 */
export function formatCountdown(secondsRemaining: number): string {
  // Negative is reachable, not defensive: a laptop that slept past the
  // deadline wakes up with one, and "-3h 12m" would read as a live link.
  if (secondsRemaining <= 0) return "Expired";

  const total = Math.floor(secondsRemaining);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  // `>=`, not `>`: at exactly 3600 the minute form prints "60m 0s".
  if (total >= 3600) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

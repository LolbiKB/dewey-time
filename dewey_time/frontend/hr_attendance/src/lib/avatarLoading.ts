/**
 * The four states an avatar can be in, and when its loading ring is on screen.
 *
 * Pure on purpose. The unit suite renders components with `renderToStaticMarkup`
 * and installs no DOM, so a `load` or `error` event can never be fired at a
 * component in a test — every assertion about what happens when a photo arrives,
 * fails, or takes too long would be untestable if this logic lived in
 * `EmployeeAvatar`. It lives here so it can actually fail.
 *
 * Spec: docs/superpowers/specs/2026-08-07-flag-queue-row-design.md, "Avatar loading".
 */

/**
 * `no-photo` and `failed` are distinct even though both render initials: only
 * `failed` was ever waiting on the network, and conflating them would make the
 * ring's dismissal condition unexpressible.
 */
export type AvatarPhase = "no-photo" | "loading" | "loaded" | "failed";

export type AvatarEvent = "load" | "error";

/**
 * How long a photo may take before the ring appears.
 *
 * A cached photo resolves in tens of milliseconds, and an indicator that appears
 * and disappears inside 50ms reads as a flicker — across forty rows, as the page
 * malfunctioning. Nothing animates unless the photo is *still* loading when this
 * elapses, so the common fast case is completely still.
 */
export const AVATAR_RING_DELAY_MS = 150;

export function initialAvatarPhase(image: string | null | undefined): AvatarPhase {
  return image ? "loading" : "no-photo";
}

/**
 * Settled phases are terminal. A browser can fire `error` after `load` when a
 * src is replaced or a decode fails late; blanking a photo that already painted
 * would be a worse bug than the half-paint this whole module exists to fix.
 */
export function nextAvatarPhase(phase: AvatarPhase, event: AvatarEvent): AvatarPhase {
  if (phase !== "loading") return phase;
  return event === "load" ? "loaded" : "failed";
}

export function showsPhoto(phase: AvatarPhase): boolean {
  return phase === "loaded";
}

/**
 * The ring resolves an ambiguity the initials alone cannot: at a glance they
 * read identically whether a photo is still arriving or none exists. It is
 * gated on the delay so the fast path stays still, and it clears on BOTH
 * outcomes — a 404 that left the row spinning forever would be the failure mode
 * the happy path hides.
 */
export function showsRing(phase: AvatarPhase, delayElapsed: boolean): boolean {
  return phase === "loading" && delayElapsed;
}

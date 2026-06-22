import { useEffect, useState } from 'react'
import { AdmsBridgeMark } from '@/brand/AdmsBridgeMark'

const PLAYED_KEY = 'adms-bridge-intro-played'

function alreadyPlayed(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(PLAYED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * One-time launch intro for the ADMS Bridge dashboard — the house mark draws
 * itself onto a blank canvas (the single-stroke pen-draw, see brand-motion.css),
 * then the "ADMS Bridge" wordtext rises, then the overlay crossfades away to
 * reveal the app. Plays once per browser session, is skippable on click, and is
 * fully disabled under prefers-reduced-motion (the draw no-ops; only a brief
 * crossfade remains).
 *
 * Mounted in AppContent's authenticated branch, so it plays on the first paint
 * of the signed-in dashboard — never over the login / access-denied screens.
 */
export function AdmsBridgeIntro() {
  const [phase, setPhase] = useState<'play' | 'closing' | 'done'>(() =>
    alreadyPlayed() ? 'done' : 'play',
  )

  useEffect(() => {
    if (phase === 'play') {
      try {
        window.sessionStorage.setItem(PLAYED_KEY, '1')
      } catch {
        /* sessionStorage unavailable (private mode) — still play, just don't persist */
      }
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const holdMs = reduce ? 700 : 2300 // draw (1.6s) + wordtext rise + a beat
      const timer = window.setTimeout(() => setPhase('closing'), holdMs)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'closing') {
      const timer = window.setTimeout(() => setPhase('done'), 500)
      return () => window.clearTimeout(timer)
    }
  }, [phase])

  if (phase === 'done') return null

  const skip = () => setPhase('closing')

  return (
    <div
      role="img"
      aria-label="ADMS Bridge"
      onClick={skip}
      className={
        'fixed inset-0 z-[100] flex items-center justify-center bg-background ' +
        'transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ' +
        (phase === 'closing' ? 'pointer-events-none opacity-0' : 'opacity-100')
      }
    >
      <div className="adms-draw flex flex-col items-center gap-6">
        <AdmsBridgeMark className="size-24 sm:size-28" />
        <div className="adms-intro-rise text-3xl font-semibold tracking-tight sm:text-4xl">
          <span className="text-foreground">ADMS</span>{' '}
          <span className="font-normal text-muted-foreground">Bridge</span>
        </div>
      </div>
    </div>
  )
}

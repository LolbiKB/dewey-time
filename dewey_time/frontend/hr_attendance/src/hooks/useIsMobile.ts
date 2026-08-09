import { useEffect, useState } from "react";

// Phone vs tablet/desktop nav-shell breakpoint (the data table switches later, at
// lg/1024 — see the responsive shell notes). dewey-ui ships a useIsMobile too, but
// it seeds from an effect (returns false on first paint → the desktop shell flashes
// on a phone). This one reads window width DURING render so the first paint is
// already correct.
const MOBILE_BREAKPOINT = 768;

const read = () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(read); // ← synchronous, during render

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(read());
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

/**
 * The GRID's breakpoint, not the nav shell's.
 *
 * MOBILE_BREAKPOINT above is 768 and drives the phone-vs-desktop shell. The
 * flag queue's split is `lg:grid` at 1024, because at 768 the panel would be
 * 340px and the decision form does not fit. Anything keyed to the split — the
 * bottom sheet that replaces it — must use this, or 768–1023px gets neither
 * the split nor the sheet.
 */
const LG_BREAKPOINT = 1024;

const readBelowLg = () =>
  typeof window !== "undefined" && window.innerWidth < LG_BREAKPOINT;

export function useIsBelowLg(): boolean {
  const [below, setBelow] = useState(readBelowLg);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${LG_BREAKPOINT - 1}px)`);
    const onChange = () => setBelow(readBelowLg());
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return below;
}

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

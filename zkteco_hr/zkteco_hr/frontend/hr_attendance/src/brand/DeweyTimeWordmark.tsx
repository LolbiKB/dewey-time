/**
 * The Dewey Time wordtext — static, two-weight, modelled on the ADMS Bridge
 * house mark: the lead word "Dewey" sits in the foreground, "Time" recedes to
 * muted. No hover-expand animation. Color identity lives in the dial mark
 * beside it (DeweyTimeMark), so the text itself stays neutral. The visible
 * text is the accessible name (AppShell links the lockup to homeHref).
 *
 * `className` controls sizing only (default header size); the two-weight
 * treatment is fixed so it reads the same everywhere it appears.
 */
export function DeweyTimeWordmark({ className = "text-sm" }: { className?: string } = {}) {
  return (
    <span className={`font-semibold tracking-tight select-none ${className}`}>
      <span className="text-foreground">Dewey</span>{" "}
      <span className="font-normal text-muted-foreground">Time</span>
    </span>
  );
}

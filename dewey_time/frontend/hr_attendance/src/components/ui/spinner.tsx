import { forwardRef } from "react"
import { Loader2Icon, type LucideIcon, type LucideProps } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A `LucideIcon`, not merely a component that renders one.
 *
 * `EmptyState`, `DeskLink` and the shell's tab items all type their `icon` prop
 * as lucide's `LucideIcon` — a `ForwardRefExoticComponent`, which a plain
 * function component is not assignable to (it lacks `$$typeof`). Forwarding the
 * ref is what makes `icon={Spinner}` type-check at those call sites; it is also
 * the honest contract, since every real lucide icon forwards to its `<svg>`.
 */
const Spinner: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(
  ({ className, ...props }, ref) => (
    <Loader2Icon
      ref={ref}
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  ),
)

Spinner.displayName = "Spinner"

export { Spinner }

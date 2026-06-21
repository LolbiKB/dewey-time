import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

interface ScrollAreaProps extends React.ComponentProps<typeof ScrollAreaPrimitive.Root> {
  /** Optional className to apply when content is scrollable */
  scrollableClassName?: string
  /** Whether to force mount scrollbar when content is scrollable */
  alwaysShowScrollbar?: boolean
}

function ScrollArea({
  className,
  children,
  scrollableClassName,
  alwaysShowScrollbar = false,
  ...props
}: ScrollAreaProps) {
  const [isScrollable, setIsScrollable] = React.useState(false)
  const viewportRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const checkScrollable = () => {
      const hasVerticalScroll = viewport.scrollHeight > viewport.clientHeight
      setIsScrollable(hasVerticalScroll)
    }

    // Check on mount and when content changes
    checkScrollable()

    // Create a ResizeObserver to detect content changes
    const resizeObserver = new ResizeObserver(checkScrollable)
    resizeObserver.observe(viewport)

    return () => {
      resizeObserver.disconnect()
    }
  }, [children])

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          isScrollable && scrollableClassName
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar forceMount={alwaysShowScrollbar && isScrollable ? true : undefined} />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  forceMount,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      forceMount={forceMount}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }

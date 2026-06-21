'use client'

import * as React from 'react'
import { motion, type Transition } from 'motion/react'
import { cn } from '@/lib/utils'

type MotionHighlightContextType = {
  value: string
  registerItem: (value: string, node: HTMLElement | null) => void
  controlledItems?: boolean
}

const MotionHighlightContext = React.createContext<MotionHighlightContextType | undefined>(undefined)

function useMotionHighlight() {
  const context = React.useContext(MotionHighlightContext)
  if (!context) {
    throw new Error('useMotionHighlight must be used within MotionHighlight')
  }
  return context
}

type MotionHighlightProps = React.ComponentProps<'div'> & {
  value: string
  children: React.ReactNode
  className?: string
  transition?: Transition
  controlledItems?: boolean
}

function MotionHighlight({
  value,
  children,
  className,
  transition = { type: 'spring', stiffness: 200, damping: 25 },
  controlledItems = false,
  ...props
}: MotionHighlightProps) {
  const [activeRect, setActiveRect] = React.useState<DOMRect | null>(null)
  const itemsRef = React.useRef(new Map<string, HTMLElement>())

  const registerItem = React.useCallback((itemValue: string, node: HTMLElement | null) => {
    if (node) {
      itemsRef.current.set(itemValue, node)
    } else {
      itemsRef.current.delete(itemValue)
    }
  }, [])

  React.useEffect(() => {
    const activeItem = itemsRef.current.get(value)
    if (activeItem) {
      setActiveRect(activeItem.getBoundingClientRect())
    }
  }, [value])

  const containerRef = React.useRef<HTMLDivElement>(null)
  const [containerRect, setContainerRect] = React.useState<DOMRect | null>(null)

  React.useEffect(() => {
    if (containerRef.current) {
      setContainerRect(containerRef.current.getBoundingClientRect())
    }
  }, [value])

  return (
    <MotionHighlightContext.Provider value={{ value, registerItem, controlledItems }}>
      <div ref={containerRef} className={cn('relative', className)} {...props}>
        {activeRect && containerRect && (
          <motion.div
            className={cn('bg-background absolute inset-0 rounded-sm shadow-sm')}
            initial={false}
            animate={{
              width: activeRect.width,
              height: activeRect.height,
              x: activeRect.left - containerRect.left,
              y: activeRect.top - containerRect.top,
            }}
            transition={transition}
          />
        )}
        {children}
      </div>
    </MotionHighlightContext.Provider>
  )
}

type MotionHighlightItemProps = React.ComponentProps<'div'> & {
  value: string
  children: React.ReactNode
}

function MotionHighlightItem({ value, children, className, ...props }: MotionHighlightItemProps) {
  const { registerItem } = useMotionHighlight()
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    registerItem(value, ref.current)
    return () => registerItem(value, null)
  }, [value, registerItem])

  return (
    <div ref={ref} className={cn('relative', className)} {...props}>
      {children}
    </div>
  )
}

export { MotionHighlight, MotionHighlightItem, useMotionHighlight }

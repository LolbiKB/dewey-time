'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/motion-tabs"

export interface TabItem {
  value: string
  label: string
  content: React.ReactNode
}

interface TabBaseModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for open state changes */
  onOpenChange: (open: boolean) => void
  /** Modal title */
  title: string
  /** Optional modal description */
  description?: string
  /** Tab items */
  tabs: TabItem[]
  /** Default active tab value */
  defaultTab?: string
  /** Controlled tab value */
  activeTab?: string
  /** Tab change handler */
  onTabChange?: (value: string) => void
  /** Optional footer content (buttons, actions) */
  footer?: React.ReactNode
  /** Optional className for dialog content */
  className?: string
}

export function TabBaseModal({
  isOpen,
  onOpenChange,
  title,
  description,
  tabs,
  defaultTab,
  activeTab,
  onTabChange,
  footer,
  className
}: TabBaseModalProps) {
  const [localActiveTab, setLocalActiveTab] = React.useState(defaultTab || tabs[0]?.value)
  const isControlled = activeTab !== undefined
  const currentTab = isControlled ? activeTab : localActiveTab

  const handleTabChange = (value: string) => {
    if (!isControlled) {
      setLocalActiveTab(value)
    }
    onTabChange?.(value)
  }

  // Reset to default tab when modal closes and reopens
  React.useEffect(() => {
    if (isOpen && !isControlled) {
      setLocalActiveTab(defaultTab || tabs[0]?.value)
    }
  }, [isOpen, defaultTab, tabs, isControlled])

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={`flex max-h-[90vh] flex-col gap-0 p-0 ${className}`}>
        <DialogHeader className="contents space-y-0 text-left">
          {/* Sticky Header with Title, Description, and Tabs */}
          <div className="border-b">
            <DialogTitle className="px-6 pt-6">{title}</DialogTitle>
            {description && (
              <DialogDescription className="px-6 pt-2 pb-4">
                {description}
              </DialogDescription>
            )}
            {/* Tabs - part of sticky header */}
            {tabs.length > 1 && (
              <div className="px-6 pb-3">
                <Tabs
                  value={currentTab}
                  onValueChange={handleTabChange}
                  className="gap-0"
                >
                  <TabsList className="w-full">
                    {tabs.map((tab) => (
                      <TabsTrigger key={tab.value} value={tab.value} className="flex-1">
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}
          </div>

          {/* Scrollable Content Only */}
          <ScrollArea className="flex max-h-full flex-col overflow-hidden">
            <div className="px-6 pt-4 pb-6">
              <AnimatePresence mode="wait">
                {tabs.map((tab) => (
                  currentTab === tab.value && (
                    <motion.div
                      key={tab.value}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      {tab.content}
                    </motion.div>
                  )
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>
        </DialogHeader>

        {/* Sticky Footer */}
        {footer && (
          <DialogFooter className="flex-row items-center justify-end border-t px-6 py-4">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

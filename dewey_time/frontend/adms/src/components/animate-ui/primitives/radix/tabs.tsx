'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { motion, AnimatePresence } from 'motion/react';

type TabsProps = Omit<TabsPrimitive.TabsProps, 'onValueChange' | 'value'> & {
  value?: string;
  onValueChange?: (value: string) => void;
};

function Tabs({ value, onValueChange, defaultValue, ...props }: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? '');
  
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;
  
  const handleValueChange = React.useCallback((newValue: string) => {
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
  }, [isControlled, onValueChange]);

  return (
    <TabsPrimitive.Root 
      value={currentValue} 
      onValueChange={handleValueChange}
      {...props} 
    />
  );
}

function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={className} {...props} />;
}

function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={className} {...props} />;
}

function TabsContent({ value, className, children }: { value: string; children: React.ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="wait">
      <TabsPrimitive.Content 
        value={value} 
        asChild
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className={className}
        >
          {children}
        </motion.div>
      </TabsPrimitive.Content>
    </AnimatePresence>
  );
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
};
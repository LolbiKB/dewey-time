import type { ComponentType } from "react";
import { Link } from "react-router-dom";

export type MobileTab = {
  label: string;
  href: string;
  active: boolean;
  icon: ComponentType<{ className?: string }>;
};

/**
 * Fixed bottom thumb-reach tab bar for phones. Replaces the top tab strip below
 * the md breakpoint (the shell empties the top tabs on mobile). Safe-area padded
 * so the home indicator never overlaps it; hidden from md up (tablets/desktop
 * keep the top tabs). Active tab carries the primary signal.
 */
export function MobileTabBar({ items }: { items: MobileTab[] }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            to={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={
              "flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors active:bg-muted/50 " +
              (tab.active ? "text-primary" : "text-muted-foreground")
            }
          >
            <Icon className="size-5 shrink-0" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

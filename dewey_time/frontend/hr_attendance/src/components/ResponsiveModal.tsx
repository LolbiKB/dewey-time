import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";

const SIZE_MAXW: Record<"sm" | "md" | "lg", string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
};

// Note: `size` and `showCloseButton` apply to the DESKTOP (Dialog) leg only.
// The mobile bottom Sheet is always full-width and uses the primitive's default close button.

export type ResponsiveModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  showCloseButton?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
};

// One adaptive quick-decision surface: a centered Dialog on desktop, a rounded-top,
// safe-area-padded bottom Sheet on mobile. Title/description/footer map onto the
// surface-specific primitives so the correct <…Title> lands in the correct context.
// The body is scrolled but NOT padded by the wrapper — callers keep their own section
// padding (matches the existing dialogs' `p-0` content + padded inner sections).
export function ResponsiveModal(props: ResponsiveModalProps) {
  const isMobile = useIsMobile();
  const size = props.size ?? "md";

  // `description` is optional by design — a surface whose body already says
  // what it is needs no second sentence — but Radix points its
  // `aria-describedby` at a description element that then never renders, and
  // warns on every open unless the omission is stated as
  // `aria-describedby={undefined}`. Say it, rather than inventing prose to
  // quiet a console warning. An own key holding `undefined` is what does the
  // work: spread last, it drops the attribute Radix set.
  const describedBy: { "aria-describedby"?: undefined } = props.description
    ? {}
    : { "aria-describedby": undefined };

  if (isMobile) {
    return (
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent
          side="bottom"
          onOpenAutoFocus={(e) => e.preventDefault()}
          {...describedBy}
          className={cn(
            "flex max-h-[min(85dvh,42rem)] flex-col gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]",
            props.className,
          )}
        >
          <SheetHeader className={cn("space-y-1.5 px-5 py-4 text-left", props.headerClassName)}>
            <SheetTitle>{props.title}</SheetTitle>
            {props.description ? <SheetDescription>{props.description}</SheetDescription> : null}
          </SheetHeader>
          <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", props.bodyClassName)}>
            {props.children}
          </div>
          {props.footer ? (
            <SheetFooter className={cn("gap-2 px-5 py-4", props.footerClassName)}>
              {props.footer}
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={props.showCloseButton ?? true}
        {...describedBy}
        className={cn(
          "flex max-h-[min(85dvh,42rem)] flex-col gap-0 p-0",
          SIZE_MAXW[size],
          props.className,
        )}
      >
        <DialogHeader className={cn("space-y-1.5 px-5 py-4 text-left", props.headerClassName)}>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
        </DialogHeader>
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", props.bodyClassName)}>
          {props.children}
        </div>
        {props.footer ? (
          <DialogFooter className={cn("gap-2 px-5 py-4", props.footerClassName)}>
            {props.footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

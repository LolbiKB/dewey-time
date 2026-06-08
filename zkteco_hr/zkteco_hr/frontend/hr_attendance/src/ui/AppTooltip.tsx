import type { ReactElement, ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TooltipSide = "top" | "right" | "bottom" | "left";

export type AppTooltipProps = {
  content: ReactNode;
  side?: TooltipSide;
  /** Skip the tooltip wrapper when there is nothing to show. */
  disabled?: boolean;
  children: ReactElement;
};

/** Standard app tooltip — dark pill with arrow (matches timeline markers). */
export function AppTooltip(props: AppTooltipProps) {
  const { content, side = "bottom", disabled, children } = props;

  if (disabled || content == null || content === "") {
    return children;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}

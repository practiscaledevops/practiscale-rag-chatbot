import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon buttons have no visible text, so they need an accessible name. */
  "aria-label": string;
  size?: "sm" | "md" | "lg";
}

/**
 * Round, icon-only button. `aria-label` is required by the type so these are
 * always announced to screen readers.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors",
        "hover:bg-surface-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-7 w-7" : size === "lg" ? "h-11 w-11" : "h-9 w-9",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
);
IconButton.displayName = "IconButton";

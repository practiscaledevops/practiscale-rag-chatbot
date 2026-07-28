import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon buttons have no visible text, so they need an accessible name. */
  "aria-label": string;
  size?: "sm" | "md";
}

/**
 * Square, icon-only button. `aria-label` is required by the type so these are
 * always announced to screen readers.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-lg text-neutral-500 transition-colors",
        "hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-7 w-7" : "h-9 w-9",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
);
IconButton.displayName = "IconButton";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "tea" | "dark";
type Size = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

// Pill buttons in the Practiscale palette (see globals.css). `tea` and `dark`
// are the two header pills of the reference kit ("Update" / "Settings").
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-foreground shadow-soft hover:bg-accent-hover",
  secondary: "border border-border bg-surface text-foreground hover:bg-surface-muted",
  ghost: "bg-transparent text-foreground hover:bg-surface-muted",
  danger: "bg-danger text-white shadow-soft hover:bg-danger/90",
  tea: "bg-tea text-tea-foreground hover:bg-tea-hover",
  dark: "bg-[#262626] text-white hover:bg-[#1c1c1c]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-sm",
};

/**
 * Pill-shaped text button. Keyboard focus shows the themed ring (--ring);
 * disabled state is dimmed and non-interactive.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";

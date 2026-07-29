import { cn } from "@/lib/utils";

/**
 * Practiscale brand marks.
 *
 * Two static wordmark assets live in /public:
 *   - logo.png        the dark wordmark — use it on LIGHT surfaces
 *   - logo-white.png  the white wordmark — use it on the DARK sidebar / heroes
 *   - logo-icon.png   the square glyph — for tight spots (favicons, avatars)
 *
 * `variant` names the SURFACE the logo sits on, not the ink colour:
 *   variant="light" (default) → dark wordmark, for light backgrounds
 *   variant="dark"            → white wordmark, for dark backgrounds
 *
 * These are decorative wordmarks with equivalent text elsewhere, so plain
 * <img> is intentional (no Next/Image optimisation needed for a tiny static
 * asset). Height is set via className — default h-7, width auto keeps ratio.
 */

type LogoVariant = "light" | "dark";

export interface LogoProps {
  /** The surface the logo sits on. Light surface → dark ink (default). */
  variant?: LogoVariant;
  /** Extra classes; override the height here, e.g. "h-8". */
  className?: string;
  /** Accessible name. Empty string renders it decorative (aria-hidden). */
  alt?: string;
}

export function Logo({ variant = "light", className, alt = "Practiscale" }: LogoProps) {
  const src = variant === "dark" ? "/logo-white.png" : "/logo.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      decoding="async"
      className={cn("h-7 w-auto select-none", className)}
    />
  );
}

export interface LogoMarkProps {
  /** Extra classes; override the size here, e.g. "h-8 w-8". */
  className?: string;
  /** Accessible name. Empty string renders it decorative (aria-hidden). */
  alt?: string;
}

/**
 * The square Practiscale glyph — for collapsed sidebars, avatars, and other
 * spots where the full wordmark is too wide.
 */
export function LogoMark({ className, alt = "Practiscale" }: LogoMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-icon.png"
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      decoding="async"
      className={cn("h-8 w-8 select-none", className)}
    />
  );
}

import { cn } from "@/lib/utils";

/**
 * The assistant's avatar: a CSS-only miniature of the BrainOrb (frosted
 * membrane, green core, drifting dot globe — see `.orb-mini` in globals.css).
 * Cheap enough for every message; pass `active` only for the one that is
 * streaming so it pulses and spins faster.
 */
export function OrbAvatar({
  size = 28,
  active = false,
  className,
}: {
  size?: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("orb-mini", active && "orb-mini--active", className)}
      style={{ width: size, height: size }}
    >
      <span className="orb-mini__membrane" />
      <span className="orb-mini__gloss" />
    </span>
  );
}

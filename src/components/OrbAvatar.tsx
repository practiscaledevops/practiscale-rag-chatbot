import { BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The assistant's avatar: the PractiScale brain mark on a green brand disc
 * (the same brain motif as the header and the revolving hero brain). Cheap
 * enough for every message; pass `active` only for the one that is streaming,
 * which adds a soft pulse ring.
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
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-[0_2px_6px_-1px_rgb(14_158_139/0.45)]",
        className
      )}
      style={{ width: size, height: size }}
    >
      {active && <span className="absolute inset-0 rounded-full bg-accent/40 motion-safe:animate-ping" />}
      <BrainCircuit size={Math.max(10, Math.round(size * 0.56))} strokeWidth={1.9} className="relative" />
    </span>
  );
}

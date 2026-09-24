"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { avatarInitials, useAvatarUrl } from "@/lib/avatar-client";

export interface UserAvatarProps {
  /** Display name (initials fallback). The name is expected to be shown next to the avatar. */
  name: string;
  email?: string | null;
  /** Server-rendered avatar URL ("/api/account/avatar?v=…") or null. */
  avatarUrl?: string | null;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/**
 * The signed-in user's round avatar: their profile picture when one exists,
 * otherwise (or if the image fails to load) their initials on the brand
 * gradient. Follows the avatar store, so it updates the moment the picture is
 * uploaded or removed anywhere on the page. Decorative (aria-hidden): the name
 * is always rendered alongside it.
 */
export function UserAvatar({ name, email, avatarUrl, size = 28, className }: UserAvatarProps) {
  const url = useAvatarUrl(avatarUrl);
  // Tracks WHICH url failed, so a new url automatically gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // An image that errored before hydration never fires React's onError; catch
  // that case on mount / url change.
  useEffect(() => {
    const img = imgRef.current;
    if (url && img && img.complete && img.naturalWidth === 0) setFailedUrl(url);
  }, [url]);

  const dim = { width: size, height: size };

  if (url && failedUrl !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- session-scoped API image; next/image can't forward the cookie
      <img
        ref={imgRef}
        src={url}
        alt=""
        aria-hidden
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        onError={() => setFailedUrl(url)}
        style={dim}
        className={cn("shrink-0 select-none rounded-full bg-surface-muted object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ ...dim, fontSize: Math.max(8, Math.round(size * 0.38)) }}
      className={cn(
        "grid shrink-0 select-none place-items-center rounded-full bg-brand-gradient font-semibold leading-none text-white",
        className
      )}
    >
      {avatarInitials(name, email)}
    </span>
  );
}

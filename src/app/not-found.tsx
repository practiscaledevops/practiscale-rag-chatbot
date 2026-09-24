// Branded 404 for unknown routes.

import Link from "next/link";
import { OrbAvatar } from "@/components/OrbAvatar";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background bg-[radial-gradient(1200px_600px_at_50%_-10%,rgb(var(--accent-soft)),transparent_60%)] px-6 text-center">
      <OrbAvatar size={56} />
      <p className="text-5xl font-semibold tracking-tight text-brand-gradient">404</p>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          That page doesn’t exist or was moved.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Back to chat
      </Link>
    </div>
  );
}

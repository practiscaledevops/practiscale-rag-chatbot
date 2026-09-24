// Lightweight loading state shown while an app route's server data resolves
// (e.g. opening a thread reads its messages). Keeps navigation from flashing an
// empty screen.

import { OrbAvatar } from "@/components/OrbAvatar";

export default function AppLoading() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center bg-background">
      <div className="flex items-center gap-2.5 rounded-full bg-surface-muted py-1 pl-1 pr-3.5 text-sm text-muted-foreground">
        <OrbAvatar size={28} active />
        <span className="flex gap-1" aria-hidden>
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
        </span>
      </div>
    </div>
  );
}

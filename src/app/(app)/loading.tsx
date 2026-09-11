// Lightweight loading state shown while an app route's server data resolves
// (e.g. opening a thread reads its messages). Keeps navigation from flashing an
// empty screen.

import { Sparkles } from "lucide-react";

export default function AppLoading() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-soft">
          <Sparkles size={15} />
        </span>
        <span className="flex gap-1" aria-hidden>
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
        </span>
      </div>
    </div>
  );
}

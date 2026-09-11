"use client";

// App-group error boundary. Any uncaught error in a route under (app) renders
// this branded recovery screen instead of Next's default crash page.

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/Button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for logs; the digest links to the server-side stack in prod.
    console.error("[app error]", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold text-foreground">Something broke on this page</h1>
        <p className="text-sm text-muted-foreground">
          The assistant is still running. You can retry this view, or head back to a new chat.
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground/70">Reference: {error.digest}</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={reset}>
          <RotateCcw size={14} />
          Try again
        </Button>
        <Button variant="secondary" size="sm" onClick={() => (window.location.href = "/")}>
          New chat
        </Button>
      </div>
    </div>
  );
}

"use client";

// App-group error boundary. Any uncaught error in a route under (app) renders
// this branded recovery screen instead of Next's default crash page.

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
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
    <div className="flex h-full min-h-[60vh] items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border border-border bg-surface p-8 text-center shadow-soft">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle size={20} aria-hidden />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Something broke on this page
          </h1>
          <p className="text-sm text-muted-foreground">
            The assistant is still running. You can retry this view, or head back to a new chat.
          </p>
          {error.digest ? (
            <p className="pt-1 text-xs text-subtle-foreground">Reference: {error.digest}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={reset}>
            <RotateCcw size={15} />
            Try again
          </Button>
          <Button variant="secondary" onClick={() => (window.location.href = "/")}>
            New chat
          </Button>
        </div>
      </div>
    </div>
  );
}

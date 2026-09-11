"use client";

// Root error boundary — catches errors thrown in the root layout itself. It must
// render its own <html>/<body> because it replaces the whole document.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f14",
          color: "#e6edf3",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            The app hit an unexpected error
          </h1>
          <p style={{ fontSize: 14, opacity: 0.7, margin: "0 0 16px" }}>
            Please reload. If it keeps happening, sign out and back in.
          </p>
          <button
            onClick={reset}
            style={{
              fontSize: 14,
              fontWeight: 500,
              padding: "8px 16px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              background: "#2dd4bf",
              color: "#04211d",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

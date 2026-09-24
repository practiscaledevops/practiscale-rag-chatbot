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
          padding: 16,
          boxSizing: "border-box",
          // Light workspace with the soft PractiScale-green wash (mirrors /login).
          background:
            "radial-gradient(1200px 600px at 50% -10%, #E6F7F1, transparent 60%), #FFFFFF",
          color: "#111315",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div
          style={{
            textAlign: "center",
            width: "100%",
            maxWidth: 380,
            padding: 20,
            boxSizing: "border-box",
            background: "#FFFFFF",
            border: "1px solid #EAECEC",
            borderRadius: 16,
            boxShadow: "0 1px 2px rgb(10 90 75 / 0.04), 0 10px 34px -6px rgb(10 90 75 / 0.12)",
          }}
        >
          <h1
            style={{
              fontSize: 20,
              lineHeight: "28px",
              fontWeight: 600,
              letterSpacing: "-0.025em",
              margin: "0 0 4px",
            }}
          >
            The app hit an unexpected error
          </h1>
          <p style={{ fontSize: 13, lineHeight: "20px", color: "#6E7375", margin: "0 0 16px" }}>
            Please reload. If it keeps happening, sign out and back in.
          </p>
          <button
            onClick={reset}
            style={{
              fontSize: 14,
              fontWeight: 500,
              height: 36,
              padding: "0 16px",
              borderRadius: 9999,
              border: "none",
              cursor: "pointer",
              background: "#10A388",
              color: "#FFFFFF",
              boxShadow: "0 1px 2px rgb(17 19 21 / 0.04), 0 4px 16px rgb(17 19 21 / 0.05)",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

// Absolute base for resolving OG/icon URLs. Override in production via
// NEXT_PUBLIC_SITE_URL; the fallback keeps local + preview builds happy.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://assistant.practiscale.co";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Practiscale Assistant",
  description: "Grounded conversational AI powered by the Practiscale Brain.",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Theme surfaces come from the shared design tokens (see globals.css). */}
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}

import type { MetadataRoute } from "next";

// Web app manifest — what makes the Assistant installable ("Install app" in
// Chrome/Edge, Add to Home Screen on iOS/Android). Served at /manifest.webmanifest.
// `display: standalone` gives it its own window and taskbar/dock icon, exactly
// like Google Chat's desktop app; `start_url` carries a query so analytics can
// tell installed launches from browser visits.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PractiScale Assistant",
    short_name: "Assistant",
    description: "Grounded, sourced answers from the PractiScale AI Brain.",
    id: "/",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#161616",
    theme_color: "#161616",
    lang: "en",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New chat", url: "/?source=pwa-shortcut", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Brain map", url: "/brain?source=pwa-shortcut", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "My learnings", url: "/learning?source=pwa-shortcut", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}

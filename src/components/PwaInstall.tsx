"use client";

import { useEffect, useState } from "react";
import { MonitorDown } from "lucide-react";
import { IconButton } from "@/components/IconButton";

// Installable-app plumbing for the Assistant:
//   1. registers the service worker (installability + offline page), and
//   2. shows an "Install app" button whenever the browser offers the native
//      install prompt (Chrome/Edge on desktop and Android). It hides itself
//      once installed or when running inside the installed app. Safari has no
//      prompt API, so iOS users add it from Share → "Add to Home Screen".

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "assistant.pwa.dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PwaInstall() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Register once; updates are picked up on the next navigation.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    setInstalled(isStandalone());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      let dismissed = false;
      try { dismissed = window.localStorage.getItem(DISMISS_KEY) === "1"; } catch { /* storage unavailable */ }
      if (!dismissed) setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !prompt) return null;

  const install = async () => {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "dismissed") {
      try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage unavailable */ }
    }
    setPrompt(null);
  };

  return (
    <IconButton aria-label="Install the Assistant as an app" title="Install app" onClick={install} className="text-accent">
      <MonitorDown size={18} />
    </IconButton>
  );
}

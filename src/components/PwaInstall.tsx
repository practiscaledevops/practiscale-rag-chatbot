"use client";

import { useEffect, useState } from "react";
import { MonitorDown } from "lucide-react";
import { IconButton } from "@/components/IconButton";

// "Install app" button for the Assistant: shown whenever the browser offers the
// native install prompt (Chrome/Edge on desktop and Android); hidden once
// installed or when running inside the installed app. Safari has no prompt
// API, so iOS users add it from Share → "Add to Home Screen". The service
// worker itself is registered on every page by PwaRegister (root layout).

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

"use client";

import { useEffect } from "react";

// Registers the service worker on EVERY page (root layout), including /login —
// Chrome/Edge only offer "Install app" once a worker controls the origin, and a
// new user meets the login page first. Production only: a worker in dev would
// serve stale chunks across hot reloads.
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

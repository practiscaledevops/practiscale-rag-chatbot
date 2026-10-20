"use client";
import { useEffect, useState } from "react";

export interface LiveCallReport {
  key: string; content?: string; version?: string; updatedAt?: string | null;
  state: "connecting" | "live" | "paused" | "reconnecting" | "unavailable";
}

/** A live overlay, never a rewrite of historical messages or model memory. */
export function useLiveCallReport(key: string | null, query: string | null, timeZone: string | undefined, scope: { knowledgeScope: string; collectionIds?: string[] }): LiveCallReport | null {
  const [report, setReport] = useState<LiveCallReport | null>(null);
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    if (!key || !query) { setReport(null); return; }
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let version: string | undefined;
    let failures = 0;
    let blocked = false;
    const patch = (fields: Partial<LiveCallReport>) => {
      if (!disposed) setReport(prev => ({ ...(prev?.key === key ? prev : { key, state: "connecting" as const }), ...fields }));
    };
    const foreground = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
    const cancel = () => { controller?.abort(); controller = null; if (timer) clearTimeout(timer); timer = null; };
    const poll = async () => {
      if (disposed || blocked || !foreground() || controller) return;
      const own = new AbortController(); controller = own;
      let nextDelay = 250;
      try {
        const res = await fetch("/api/call-reports", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...JSON.parse(scopeKey), query, timeZone, version, waitMs: version ? 20_000 : 0 }), cache: "no-store", signal: own.signal });
        if ([400, 401, 403].includes(res.status)) { blocked = true; patch({ state: "unavailable" }); return; }
        if (!res.ok) throw Error("Live report unavailable");
        const data = await res.json();
        if (typeof data.version !== "string" || (!data.unchanged && typeof data.content !== "string")) throw Error("Invalid live report");
        if (disposed || own.signal.aborted) return;
        version = data.version; failures = 0;
        patch({ state: "live", version, updatedAt: data.updatedAt, ...(!data.unchanged ? { content: data.content } : {}) });
      } catch {
        if (disposed || own.signal.aborted) return;
        failures++; nextDelay = Math.min(15_000, 1000 * 2 ** Math.min(failures, 4)); patch({ state: "reconnecting" });
      } finally {
        if (controller === own) controller = null;
        if (!disposed && !blocked && !own.signal.aborted && foreground()) timer = setTimeout(poll, nextDelay);
      }
    };
    const resume = () => {
      cancel();
      if (!foreground()) { patch({ state: "paused" }); return; }
      // A foreground return checks immediately, including after a lost network.
      blocked = false; version = undefined; patch({ state: "connecting" }); void poll();
    };
    setReport({ key, state: foreground() ? "connecting" : "paused" });
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume); window.addEventListener("offline", resume);
    void poll();
    return () => { disposed = true; cancel(); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", resume); };
  }, [key, query, timeZone, scopeKey]);
  return report?.key === key ? report : null;
}

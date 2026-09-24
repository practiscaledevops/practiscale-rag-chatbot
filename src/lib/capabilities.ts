// Server-side access to the Brain's capability manifest (GET /api/v1/capabilities).
//
// SECURITY: like lib/brain.ts and lib/models.ts, this reads BRAIN_API_KEY from
// the server environment and must NEVER be imported into a client component.
// The browser gets the manifest only through this app's admin API
// (/api/admin/capabilities, /api/admin/users), which are admin-gated.
//
// fetchCapabilityManifest() returns the Brain's manifest merged with this app's
// own capabilities (projects, executive memory), cached in memory for ~5
// minutes. When the Brain is unreachable (or in DEMO mode) it falls back to the
// BUILT-IN manifest (lib/capabilities-shared — a mirror of today's Brain) and
// flags `source: "fallback"`, so the admin panel keeps working. Each successful
// fetch also becomes the default manifest for the synchronous permission
// helpers (lib/access, lib/work-modes) on this server instance.
//
// The pure types/helpers live in lib/capabilities-shared (client-safe); they are
// re-exported here for server callers.

import { z } from "zod";
import { isDemo } from "@/lib/demo/mode";
import {
  BUILTIN_CAPABILITY_MANIFEST,
  getActiveManifest,
  setActiveManifest,
  withAppCapabilities,
  isCapabilityId,
  type Capability,
  type CapabilityGroup,
  type CapabilityKind,
  type CapabilityManifest,
  type ResolvedCapabilityManifest,
} from "@/lib/capabilities-shared";

export * from "@/lib/capabilities-shared";

// Same base URL + auth header logic as lib/brain.ts (which doesn't export them).
const BRAIN_URL = resolveBrainUrl();
const BRAIN_KEY = process.env.BRAIN_API_KEY ?? "";

function resolveBrainUrl(): string {
  const url = process.env.BRAIN_API_URL;
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BRAIN_API_URL must be set in production");
  }
  return "http://localhost:3000";
}

function authHeaders(): Record<string, string> {
  if (!BRAIN_KEY) throw new Error("BRAIN_API_KEY is not set");
  return { authorization: `Bearer ${BRAIN_KEY}` };
}

/** How long a live manifest is reused. */
const TTL_MS = 5 * 60_000;
/** After a failure, retry the Brain this soon (the fallback serves meanwhile). */
const FAILURE_TTL_MS = 60_000;
/** The manifest is small; a slow Brain must not stall an admin page. */
const TIMEOUT_MS = 4_000;

let cached: { value: ResolvedCapabilityManifest; expiresAt: number } | null = null;
let inflight: Promise<ResolvedCapabilityManifest> | null = null;

function fallback(reason: string): ResolvedCapabilityManifest {
  return { ...BUILTIN_CAPABILITY_MANIFEST, reason, fetchedAt: new Date().toISOString() };
}

/**
 * The Brain's capability manifest (+ this app's capabilities), from a ~5-minute
 * in-memory cache. Never throws: on any failure it returns the built-in
 * manifest with `source: "fallback"` and a `reason`.
 */
export async function fetchCapabilityManifest(opts: { force?: boolean } = {}): Promise<ResolvedCapabilityManifest> {
  if (isDemo()) return fallback("demo mode");
  const now = Date.now();
  if (!opts.force && cached && cached.expiresAt > now) return cached.value;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const value = await loadFromBrain();
      cached = { value, expiresAt: Date.now() + TTL_MS };
      setActiveManifest(value);
      return value;
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Brain unreachable";
      console.error("[capabilities] manifest fetch failed:", reason);
      // Keep serving the last live manifest if we have one; else the built-in list.
      const value = cached?.value.source === "brain" ? cached.value : fallback(reason);
      cached = { value, expiresAt: Date.now() + FAILURE_TTL_MS };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * The manifest to use RIGHT NOW without waiting on the network: the cached one
 * (live or fallback), else the active default. Kicks off a background refresh
 * when the cache is cold or stale, so the next request sees the live manifest.
 */
export function peekCapabilityManifest(): ResolvedCapabilityManifest {
  if (isDemo()) return BUILTIN_CAPABILITY_MANIFEST;
  if (!cached || cached.expiresAt <= Date.now()) {
    void fetchCapabilityManifest().catch(() => undefined);
  }
  return cached?.value ?? getActiveManifest();
}

async function loadFromBrain(): Promise<ResolvedCapabilityManifest> {
  const res = await fetch(`${BRAIN_URL}/api/v1/capabilities`, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Brain answered ${res.status}`);
  const payload = await res.json().catch(() => null);
  const manifest = parseManifest(payload);
  if (!manifest) throw new Error("Brain manifest was empty or unreadable");
  return withAppCapabilities(manifest, { source: "brain", fetchedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Defensive parsing: one malformed entry is skipped, never fatal.
// ---------------------------------------------------------------------------

const KINDS: readonly CapabilityKind[] = ["feature", "mode", "source_type", "tool"];

const capabilitySchema = z.object({
  id: z.string().refine(isCapabilityId),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).default(""),
  group: z.string().trim().min(1).max(60),
  kind: z.string().optional(),
  sensitive: z.boolean().optional(),
  // A capability that doesn't say is treated cautiously: off for members.
  defaultForMembers: z.boolean().default(false),
  defaultForAdmins: z.boolean().default(true),
  requires: z.array(z.string()).max(20).optional(),
  since: z.string().max(40).optional(),
  section: z.string().trim().max(60).optional(),
});

const groupSchema = z.object({ id: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(80) });

/** Parse the Brain's JSON into a manifest; null when nothing usable came back. */
export function parseManifest(payload: unknown): CapabilityManifest | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const rawCaps = Array.isArray(p.capabilities) ? p.capabilities : [];

  const seen = new Set<string>();
  const capabilities: Capability[] = [];
  for (const raw of rawCaps.slice(0, 500)) {
    const r = capabilitySchema.safeParse(raw);
    if (!r.success || seen.has(r.data.id)) continue;
    seen.add(r.data.id);
    const d = r.data;
    const c: Capability = {
      id: d.id,
      label: d.label,
      description: d.description,
      group: d.group,
      kind: KINDS.includes(d.kind as CapabilityKind) ? (d.kind as CapabilityKind) : "feature",
      // Sensitive capabilities are never on for members by default, whatever the payload says.
      defaultForMembers: d.sensitive ? false : d.defaultForMembers,
      defaultForAdmins: d.defaultForAdmins,
    };
    if (d.sensitive) c.sensitive = true;
    const requires = (d.requires ?? []).filter(isCapabilityId);
    if (requires.length) c.requires = requires;
    if (d.since) c.since = d.since;
    if (d.section) c.section = d.section;
    capabilities.push(c);
  }
  if (capabilities.length === 0) return null;

  const groups: CapabilityGroup[] = [];
  for (const raw of Array.isArray(p.groups) ? p.groups : []) {
    const g = groupSchema.safeParse(raw);
    if (g.success && !groups.some((x) => x.id === g.data.id)) groups.push(g.data);
  }

  return {
    version: typeof p.version === "number" && Number.isFinite(p.version) ? p.version : 1,
    generatedAt: typeof p.generatedAt === "string" ? p.generatedAt : new Date().toISOString(),
    groups,
    capabilities,
  };
}

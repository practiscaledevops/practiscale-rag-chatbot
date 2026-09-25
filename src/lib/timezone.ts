// The asking user's time zone, for dates in answers.
//
// The Brain resolves every relative or explicit date ("today's calls",
// "yesterday", "this week", "last 7 days", "Sep 24") in the ASKING user's IANA
// time zone, DST-aware, and shows call dates in it. When a request carries no
// zone the Brain uses its own business zone (SCORING_TIME_ZONE, Asia/Karachi
// by default). The team works from Pakistan while the CEO works from the USA,
// so every chat / audit / compaction request sends the user's own zone.
//
// Safe on the client AND the server (only Intl, no DOM or Node APIs):
//   • the browser decides which zone to send: Settings → Time zone, where
//     "auto" (the default) means this device's zone (effectiveTimeZone);
//   • the API routes re-validate what arrives (timeZoneOrUndefined) and forward
//     it to the Brain (lib/brain), which checks it again.
//
// There is deliberately no business-zone fallback on this side: when no zone
// can be determined the field is left out (undefined is dropped by
// JSON.stringify, the routes and lib/brain timeZoneField), so the Brain's
// configured SCORING_TIME_ZONE applies instead of a hard-coded Karachi.

/** Preference value: use this device's zone. */
export const TIME_ZONE_AUTO = "auto";

/** Label for the "auto" choice when the device's zone isn't known yet. */
export const TIME_ZONE_AUTO_LABEL = "Auto (this device)";

/** Longest zone id accepted (the longest IANA id today is 32 characters). */
export const MAX_TIME_ZONE_CHARS = 64;

/**
 * IANA-shaped ids only: "Area/Location[/Sub]", "UTC", "EST5EDT", "Etc/GMT+5".
 * Offset strings ("+05:00") and anything with spaces or dots are refused.
 */
const TIME_ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,3}$/;

export interface TimeZoneOption {
  /** An IANA zone id, or TIME_ZONE_AUTO. */
  id: string;
  label: string;
}

/** The zones the Settings picker offers (any other valid IANA id is accepted too). */
export const COMMON_TIME_ZONES: readonly TimeZoneOption[] = [
  { id: "America/New_York", label: "Eastern Time (New York)" },
  { id: "America/Chicago", label: "Central Time (Chicago)" },
  { id: "America/Denver", label: "Mountain Time (Denver)" },
  { id: "America/Phoenix", label: "Arizona (Phoenix, no DST)" },
  { id: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { id: "America/Anchorage", label: "Alaska (Anchorage)" },
  { id: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { id: "Europe/London", label: "UK (London)" },
  { id: "Asia/Dubai", label: "Gulf (Dubai)" },
  { id: "Asia/Karachi", label: "Pakistan (Karachi)" },
  { id: "Asia/Kolkata", label: "India (Kolkata)" },
  { id: "Australia/Sydney", label: "Australia Eastern (Sydney)" },
  { id: "UTC", label: "UTC" },
];

/** "Auto (this device)" followed by the common zones: the picker's base list. */
export const TIME_ZONE_CHOICES: readonly TimeZoneOption[] = [
  { id: TIME_ZONE_AUTO, label: TIME_ZONE_AUTO_LABEL },
  ...COMMON_TIME_ZONES,
];

// One formatter per zone (validity check + offset lookups). Bounded, because
// the server builds these from untrusted request values.
const MAX_CACHED_FORMATTERS = 200;
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  let f: Intl.DateTimeFormat | null;
  try {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    f = null; // RangeError: not a zone this engine knows
  }
  if (formatters.size >= MAX_CACHED_FORMATTERS) formatters.clear();
  formatters.set(timeZone, f);
  return f;
}

/** Whether `v` is an IANA time zone id this engine understands. */
export function isValidTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_TIME_ZONE_CHARS) return false;
  if (!TIME_ZONE_RE.test(v)) return false;
  return zoneFormatter(v) !== null;
}

/**
 * A usable IANA zone from an untrusted value, else undefined. Casing is
 * normalized ("america/new_york" → "America/New_York") but aliases are kept as
 * sent ("Asia/Kolkata" is not rewritten to "Asia/Calcutta"). For request
 * bodies: `timeZone: z.unknown().optional().transform(timeZoneOrUndefined)`.
 */
export function timeZoneOrUndefined(v: unknown): string | undefined {
  if (!isValidTimeZone(v)) return undefined;
  const lower = v.toLowerCase();
  const known = COMMON_TIME_ZONES.find((z) => z.id.toLowerCase() === lower);
  if (known) return known.id;
  try {
    const resolved = zoneFormatter(v)?.resolvedOptions().timeZone;
    if (typeof resolved === "string" && resolved.toLowerCase() === lower) return resolved;
  } catch {
    /* keep the value as sent: it is already known to be valid */
  }
  return v;
}

/**
 * This device's IANA zone (Intl), else `fallback` when that is a valid zone,
 * else undefined (the zone can't be read or isn't one this engine knows).
 * Meant for the browser: on the server it would be the server's own zone.
 */
export function browserTimeZone(fallback?: string): string | undefined {
  let detected: unknown;
  try {
    detected = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    detected = undefined;
  }
  return timeZoneOrUndefined(detected) ?? timeZoneOrUndefined(fallback);
}

/**
 * The zone to send with a request: the saved preference when it is a valid
 * zone, else (for "auto", nothing saved, or a stale value) this device's zone.
 * undefined when neither is usable: the field is then omitted and the Brain's
 * SCORING_TIME_ZONE applies. Call it in the browser, e.g.
 * `timeZone: effectiveTimeZone(readPrefs())`.
 */
export function effectiveTimeZone(prefs?: { timeZone?: unknown } | null): string | undefined {
  const pref = prefs?.timeZone;
  if (pref !== TIME_ZONE_AUTO) {
    const zone = timeZoneOrUndefined(pref);
    if (zone) return zone;
  }
  return browserTimeZone();
}

/** A stored preference as the picker shows it: a valid IANA zone, else "auto". */
export function timeZonePrefValue(v: unknown): string {
  if (v === TIME_ZONE_AUTO) return TIME_ZONE_AUTO;
  return timeZoneOrUndefined(v) ?? TIME_ZONE_AUTO;
}

/**
 * The zone's offset from UTC at the instant `at`, in minutes (DST-aware:
 * America/New_York is -300 in January and -240 in July). null when the zone
 * or the date is unusable.
 */
export function utcOffsetMinutes(timeZone: string, at: Date = new Date()): number | null {
  const t = at.getTime();
  if (!isValidTimeZone(timeZone) || Number.isNaN(t)) return null;
  const f = zoneFormatter(timeZone);
  if (!f) return null;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  // Some engines print midnight as hour 24 despite hourCycle "h23".
  const hour = p.hour === 24 ? 0 : p.hour;
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second);
  if (Number.isNaN(wallAsUtc)) return null;
  const wholeSeconds = Math.floor(t / 1000) * 1000;
  return Math.round((wallAsUtc - wholeSeconds) / 60_000);
}

/** "UTC+05:00", "UTC−04:00" (a true minus sign), "UTC+05:30", "UTC+00:00". */
export function formatUtcOffset(minutes: number): string {
  const rounded = Math.round(minutes);
  const sign = rounded < 0 ? "−" : "+";
  const abs = Math.abs(rounded);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

/**
 * The Settings picker's options: "Auto" (naming the detected zone once it is
 * known, e.g. "Auto · America/New_York"), the common zones (with their UTC
 * offset at `at`, when given) and, if the saved zone is not one of them, that
 * zone as well so the picker can show it. Pass `deviceZone` / `at` only after
 * mount, so the server render and the first client render match.
 */
export function timeZonePickerOptions({
  current,
  deviceZone,
  at,
}: {
  current?: string;
  deviceZone?: string | null;
  at?: Date | null;
} = {}): TimeZoneOption[] {
  const withOffset = (id: string, label: string): string => {
    const offset = at ? utcOffsetMinutes(id, at) : null;
    return offset === null ? label : `${label} · ${formatUtcOffset(offset)}`;
  };
  const options: TimeZoneOption[] = [
    { id: TIME_ZONE_AUTO, label: deviceZone ? `Auto · ${deviceZone}` : TIME_ZONE_AUTO_LABEL },
    ...COMMON_TIME_ZONES.map((z) => ({ id: z.id, label: withOffset(z.id, z.label) })),
  ];
  const saved = current === TIME_ZONE_AUTO ? undefined : timeZoneOrUndefined(current);
  if (saved && !options.some((o) => o.id === saved)) {
    options.push({ id: saved, label: withOffset(saved, saved.replace(/_/g, " ")) });
  }
  return options;
}

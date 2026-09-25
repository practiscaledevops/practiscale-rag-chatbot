import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMMON_TIME_ZONES,
  TIME_ZONE_AUTO,
  TIME_ZONE_AUTO_LABEL,
  TIME_ZONE_CHOICES,
  browserTimeZone,
  effectiveTimeZone,
  formatUtcOffset,
  isValidTimeZone,
  timeZoneOrUndefined,
  timeZonePickerOptions,
  timeZonePrefValue,
  utcOffsetMinutes,
} from "@/lib/timezone";
import { effectiveTimeZone as effectiveTimeZoneFromPrefs } from "@/lib/prefs";

// lib/timezone: which zone a request carries ("today's calls" for a CEO in the
// USA vs a team in Pakistan), validation of untrusted zone values, and
// DST-aware offsets for the Settings picker.

afterEach(() => {
  vi.restoreAllMocks();
});

/** Make this "device" report `timeZone` (or throw) from Intl. */
function deviceZone(timeZone: string | undefined | Error) {
  const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions");
  if (timeZone instanceof Error) {
    spy.mockImplementation(() => {
      throw timeZone;
    });
  } else {
    spy.mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions);
  }
  return spy;
}

describe("isValidTimeZone", () => {
  it("accepts IANA zones", () => {
    for (const z of [
      "America/New_York",
      "Asia/Karachi",
      "Asia/Kolkata",
      "Australia/Sydney",
      "America/Argentina/Buenos_Aires",
      "America/Port-au-Prince",
      "Etc/GMT+5",
      "UTC",
    ]) {
      expect(isValidTimeZone(z), z).toBe(true);
    }
  });

  it("refuses non-strings, unknown zones, offsets and odd shapes", () => {
    for (const v of [
      undefined,
      null,
      0,
      {},
      ["America/New_York"],
      "",
      "auto",
      "Mars/Olympus_Mons",
      "+05:00",
      "-04:00",
      "America/New York",
      "../etc/passwd",
      "America//New_York",
      "/America/New_York",
      "America/New_York ",
      `America/${"X".repeat(70)}`,
    ]) {
      expect(isValidTimeZone(v), String(v)).toBe(false);
    }
  });
});

describe("timeZoneOrUndefined", () => {
  it("returns valid zones with canonical casing", () => {
    expect(timeZoneOrUndefined("America/New_York")).toBe("America/New_York");
    expect(timeZoneOrUndefined("america/new_york")).toBe("America/New_York");
    expect(timeZoneOrUndefined("utc")).toBe("UTC");
    expect(timeZoneOrUndefined("europe/paris")).toBe("Europe/Paris");
  });

  it("keeps aliases as sent (Kolkata is not rewritten to Calcutta)", () => {
    expect(timeZoneOrUndefined("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(timeZoneOrUndefined("asia/kolkata")).toBe("Asia/Kolkata");
    expect(timeZoneOrUndefined("US/Eastern")).toBe("US/Eastern");
  });

  it("drops anything unusable", () => {
    expect(timeZoneOrUndefined(undefined)).toBeUndefined();
    expect(timeZoneOrUndefined(42)).toBeUndefined();
    expect(timeZoneOrUndefined("Not/AZone")).toBeUndefined();
    expect(timeZoneOrUndefined("+05:00")).toBeUndefined();
    expect(timeZoneOrUndefined(TIME_ZONE_AUTO)).toBeUndefined();
  });
});

describe("browserTimeZone", () => {
  it("reads the device's zone from Intl", () => {
    deviceZone("America/Chicago");
    expect(browserTimeZone()).toBe("America/Chicago");
  });

  it("is undefined (never a hard-coded Karachi) when the device's zone is missing or unusable", () => {
    // Omitting the zone lets the Brain's SCORING_TIME_ZONE apply.
    deviceZone(undefined);
    expect(browserTimeZone()).toBeUndefined();
    vi.restoreAllMocks();
    deviceZone("Etc/Unknown_Zone");
    expect(browserTimeZone()).toBeUndefined();
    vi.restoreAllMocks();
    deviceZone(new RangeError("no Intl"));
    expect(browserTimeZone()).toBeUndefined();
  });

  it("uses an explicit fallback only when it is a valid zone", () => {
    deviceZone(new RangeError("no Intl"));
    expect(browserTimeZone("UTC")).toBe("UTC");
    expect(browserTimeZone("america/new_york")).toBe("America/New_York");
    expect(browserTimeZone("+05:00")).toBeUndefined();
    vi.restoreAllMocks();
    deviceZone("America/Chicago");
    expect(browserTimeZone("UTC")).toBe("America/Chicago");
  });

  it("returns a real zone on this machine", () => {
    expect(isValidTimeZone(browserTimeZone())).toBe(true);
  });
});

describe("effectiveTimeZone", () => {
  it("uses a saved zone when valid", () => {
    deviceZone("Asia/Karachi");
    expect(effectiveTimeZone({ timeZone: "America/New_York" })).toBe("America/New_York");
    expect(effectiveTimeZone({ timeZone: "america/los_angeles" })).toBe("America/Los_Angeles");
  });

  it("uses the device's zone for auto, nothing saved, or a stale value", () => {
    deviceZone("America/Denver");
    expect(effectiveTimeZone({ timeZone: TIME_ZONE_AUTO })).toBe("America/Denver");
    expect(effectiveTimeZone({})).toBe("America/Denver");
    expect(effectiveTimeZone(undefined)).toBe("America/Denver");
    expect(effectiveTimeZone(null)).toBe("America/Denver");
    expect(effectiveTimeZone({ timeZone: "Gone/Zone" })).toBe("America/Denver");
    expect(effectiveTimeZone({ timeZone: 5 })).toBe("America/Denver");
  });

  it("is undefined when neither the preference nor the device gives a zone, so the field is omitted", () => {
    deviceZone(undefined);
    expect(effectiveTimeZone({ timeZone: TIME_ZONE_AUTO })).toBeUndefined();
    expect(effectiveTimeZone({})).toBeUndefined();
    expect(effectiveTimeZone({ timeZone: "Gone/Zone" })).toBeUndefined();
    expect(JSON.parse(JSON.stringify({ query: "today's calls", timeZone: effectiveTimeZone(null) }))).toEqual({
      query: "today's calls",
    });
    // A saved zone still wins when the device can't report one.
    expect(effectiveTimeZone({ timeZone: "America/New_York" })).toBe("America/New_York");
  });

  it("is re-exported from lib/prefs for the chat body one-liner", () => {
    expect(effectiveTimeZoneFromPrefs).toBe(effectiveTimeZone);
  });
});

describe("timeZonePrefValue", () => {
  it("keeps auto and valid zones, else auto", () => {
    expect(timeZonePrefValue(TIME_ZONE_AUTO)).toBe(TIME_ZONE_AUTO);
    expect(timeZonePrefValue("America/Phoenix")).toBe("America/Phoenix");
    expect(timeZonePrefValue("america/phoenix")).toBe("America/Phoenix");
    expect(timeZonePrefValue(undefined)).toBe(TIME_ZONE_AUTO);
    expect(timeZonePrefValue("Nope/Nope")).toBe(TIME_ZONE_AUTO);
    expect(timeZonePrefValue({})).toBe(TIME_ZONE_AUTO);
  });
});

describe("utcOffsetMinutes", () => {
  const winter = new Date("2026-01-15T12:00:00Z");
  const summer = new Date("2026-07-15T12:00:00Z");

  it("is DST-aware", () => {
    expect(utcOffsetMinutes("America/New_York", winter)).toBe(-300);
    expect(utcOffsetMinutes("America/New_York", summer)).toBe(-240);
    expect(utcOffsetMinutes("America/Los_Angeles", winter)).toBe(-480);
    expect(utcOffsetMinutes("America/Los_Angeles", summer)).toBe(-420);
    expect(utcOffsetMinutes("Europe/London", winter)).toBe(0);
    expect(utcOffsetMinutes("Europe/London", summer)).toBe(60);
    // Southern hemisphere: DST in January.
    expect(utcOffsetMinutes("Australia/Sydney", winter)).toBe(660);
    expect(utcOffsetMinutes("Australia/Sydney", summer)).toBe(600);
  });

  it("handles zones without DST and half-hour offsets", () => {
    expect(utcOffsetMinutes("America/Phoenix", winter)).toBe(-420);
    expect(utcOffsetMinutes("America/Phoenix", summer)).toBe(-420);
    expect(utcOffsetMinutes("Asia/Karachi", summer)).toBe(300);
    expect(utcOffsetMinutes("Asia/Kolkata", summer)).toBe(330);
    expect(utcOffsetMinutes("UTC", summer)).toBe(0);
  });

  it("is right on either side of a DST change (US spring forward, 2026-03-08 07:00Z)", () => {
    expect(utcOffsetMinutes("America/New_York", new Date("2026-03-08T06:59:59Z"))).toBe(-300);
    expect(utcOffsetMinutes("America/New_York", new Date("2026-03-08T07:00:00Z"))).toBe(-240);
  });

  it("is right at local midnight and with sub-second instants", () => {
    expect(utcOffsetMinutes("America/New_York", new Date("2026-09-24T04:00:00Z"))).toBe(-240);
    expect(utcOffsetMinutes("Asia/Karachi", new Date("2026-09-23T19:00:00.999Z"))).toBe(300);
  });

  it("returns null for an unusable zone or date", () => {
    expect(utcOffsetMinutes("Not/AZone", summer)).toBeNull();
    expect(utcOffsetMinutes("America/New_York", new Date(Number.NaN))).toBeNull();
  });
});

describe("formatUtcOffset", () => {
  it("formats with a true minus sign and zero padding", () => {
    expect(formatUtcOffset(-240)).toBe("UTC−04:00");
    expect(formatUtcOffset(300)).toBe("UTC+05:00");
    expect(formatUtcOffset(330)).toBe("UTC+05:30");
    expect(formatUtcOffset(-570)).toBe("UTC−09:30");
    expect(formatUtcOffset(0)).toBe("UTC+00:00");
  });
});

describe("the picker's zones", () => {
  it("offers Auto first, then the common zones, all valid", () => {
    expect(TIME_ZONE_CHOICES[0]).toEqual({ id: TIME_ZONE_AUTO, label: "Auto (this device)" });
    const ids = COMMON_TIME_ZONES.map((z) => z.id);
    for (const id of [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Phoenix",
      "Europe/London",
      "Asia/Karachi",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Australia/Sydney",
    ]) {
      expect(ids).toContain(id);
    }
    for (const id of ids) expect(isValidTimeZone(id), id).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("before mount: plain labels and a generic Auto (matches the server render)", () => {
    const options = timeZonePickerOptions({ current: TIME_ZONE_AUTO });
    expect(options.map((o) => o.id)).toEqual(TIME_ZONE_CHOICES.map((o) => o.id));
    expect(options[0].label).toBe(TIME_ZONE_AUTO_LABEL);
    expect(options.find((o) => o.id === "America/New_York")?.label).toBe("Eastern Time (New York)");
  });

  it("after mount: names the detected zone and shows each zone's current offset", () => {
    const at = new Date("2026-09-24T15:00:00Z");
    const options = timeZonePickerOptions({ current: TIME_ZONE_AUTO, deviceZone: "America/New_York", at });
    expect(options[0].label).toBe("Auto · America/New_York");
    expect(options.find((o) => o.id === "America/New_York")?.label).toBe("Eastern Time (New York) · UTC−04:00");
    expect(options.find((o) => o.id === "Asia/Karachi")?.label).toBe("Pakistan (Karachi) · UTC+05:00");
  });

  it("adds a saved zone that isn't in the common list, once", () => {
    const at = new Date("2026-09-24T15:00:00Z");
    const options = timeZonePickerOptions({ current: "Europe/Paris", at });
    expect(options.at(-1)).toEqual({ id: "Europe/Paris", label: "Europe/Paris · UTC+02:00" });
    expect(options.filter((o) => o.id === "Europe/Paris")).toHaveLength(1);
    expect(timeZonePickerOptions({ current: "America/Chicago" })).toHaveLength(TIME_ZONE_CHOICES.length);
    expect(timeZonePickerOptions({ current: "Bad/Zone" })).toHaveLength(TIME_ZONE_CHOICES.length);
    expect(timeZonePickerOptions({ current: "America/Argentina/Buenos_Aires" }).at(-1)?.label).toBe(
      "America/Argentina/Buenos Aires"
    );
  });
});

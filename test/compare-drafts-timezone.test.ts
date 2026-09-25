import { afterEach, describe, expect, it, vi } from "vitest";
import { compareRequestBody } from "@/app/(app)/_components/CompareDrafts";
import { TIME_ZONE_AUTO } from "@/lib/timezone";

// Compare drafts posts to /api/chat like the main chat does, so "summarise
// today's calls" for the CEO in the USA must carry his zone, not fall back to
// the Brain's Karachi default.

afterEach(() => {
  vi.restoreAllMocks();
});

function deviceZone(timeZone: string | undefined) {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

const messages = [{ role: "user" as const, content: "list all today's calls" }];

describe("compareRequestBody", () => {
  it("sends the saved Settings zone", () => {
    deviceZone("Asia/Karachi");
    expect(compareRequestBody(messages, "claude-x", "auto", { timeZone: "America/New_York" })).toEqual({
      messages,
      model: "claude-x",
      tier: "claude-x",
      mode: "auto",
      timeZone: "America/New_York",
    });
  });

  it("sends this device's zone for auto", () => {
    deviceZone("America/Chicago");
    expect(compareRequestBody(messages, "gpt-x", "general", { timeZone: TIME_ZONE_AUTO }).timeZone).toBe(
      "America/Chicago"
    );
    expect(compareRequestBody(messages, "gpt-x", "general", {}).timeZone).toBe("America/Chicago");
  });

  it("omits the zone when none can be determined, so the Brain's default applies", () => {
    deviceZone(undefined);
    const body = compareRequestBody(messages, "gpt-x", "general", {});
    expect(body).not.toHaveProperty("timeZone");
    expect(JSON.parse(JSON.stringify(body))).toEqual({ messages, model: "gpt-x", tier: "gpt-x", mode: "general" });
  });
});

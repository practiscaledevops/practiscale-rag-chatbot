import { describe, it, expect } from "vitest";
import { parseOptions, friendlyError } from "@/lib/chat-format";

describe("parseOptions", () => {
  it("lifts a closed options block out of the text and returns the choices", () => {
    const content =
      "Who are these reels for?\n\n```options\nPakistani recruitment audience\nHealthcare business owners\nBoth mixed across the 5\n```";
    const { text, options } = parseOptions(content);
    expect(text).toBe("Who are these reels for?");
    expect(options).toEqual([
      "Pakistani recruitment audience",
      "Healthcare business owners",
      "Both mixed across the 5",
    ]);
  });

  it("strips list markers inside the block", () => {
    const { options } = parseOptions("Pick:\n```options\n- One\n2. Two\n* Three\n```");
    expect(options).toEqual(["One", "Two", "Three"]);
  });

  it("hides an unclosed block while streaming (no options yet)", () => {
    const { text, options } = parseOptions("Who is this for?\n```options\nPartial line");
    expect(text).toBe("Who is this for?");
    expect(options).toEqual([]);
  });

  it("returns the content unchanged when there is no options block", () => {
    const content = "Here is a normal answer with a list:\n- a\n- b";
    expect(parseOptions(content)).toEqual({ text: content, options: [] });
  });

  it("caps at 8 options", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `opt ${i}`).join("\n");
    const { options } = parseOptions(`Pick:\n\`\`\`options\n${lines}\n\`\`\``);
    expect(options).toHaveLength(8);
  });
});

describe("friendlyError", () => {
  it("returns a fallback for an empty/undefined error", () => {
    expect(friendlyError(undefined)).toMatch(/something went wrong/i);
    expect(friendlyError({ message: "" })).toMatch(/something went wrong/i);
  });

  it("extracts `detail` then `error` from a JSON upstream body", () => {
    expect(friendlyError({ message: '{"error":"Brain request failed","detail":"rate limited"}' })).toBe(
      "rate limited"
    );
    expect(friendlyError({ message: '{"error":"Unauthorized"}' })).toBe("Unauthorized");
  });

  it("passes a plain (non-JSON) message through", () => {
    expect(friendlyError({ message: "The assistant hit an error." })).toBe(
      "The assistant hit an error."
    );
  });

  it("truncates a very long message", () => {
    const long = "x".repeat(400);
    const out = friendlyError({ message: long });
    expect(out.length).toBeLessThanOrEqual(281);
    expect(out.endsWith("…")).toBe(true);
  });
});

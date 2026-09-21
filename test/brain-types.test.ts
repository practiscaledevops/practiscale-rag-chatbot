import { describe, it, expect } from "vitest";
import {
  ACCEPTED_ACCEPT,
  MAX_AUDIO_BYTES,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  attachmentKind,
  isBrainExtractedKind,
  isSupportedName,
  maxBytesFor,
  maxMbFor,
  statusLabelFor,
} from "@/lib/attachments-shared";
import {
  authorityLabel,
  askPrompt,
  classLabel,
  conflictSentence,
  domainLabel,
  formatMetricValue,
  formatPeriod,
  humanize,
  parseConflictsEvent,
  parsePerformanceEvent,
  relationshipLabel,
} from "@/lib/brain-types";

describe("attachment kinds + size limits", () => {
  it("maps extensions to kinds, case-insensitively", () => {
    expect(attachmentKind("notes.txt")).toBe("text");
    expect(attachmentKind("README.MD")).toBe("text");
    expect(attachmentKind("data.csv")).toBe("text");
    expect(attachmentKind("book.xlsx")).toBe("sheet");
    expect(attachmentKind("old.XLS")).toBe("sheet");
    expect(attachmentKind("proposal.pdf")).toBe("pdf");
    expect(attachmentKind("shot.PNG")).toBe("image");
    expect(attachmentKind("photo.jpeg")).toBe("image");
    expect(attachmentKind("pic.webp")).toBe("image");
    expect(attachmentKind("voice.m4a")).toBe("audio");
    expect(attachmentKind("call.mp3")).toBe("audio");
    expect(attachmentKind("memo.webm")).toBe("audio");
  });

  it("rejects unknown types and names without an extension", () => {
    expect(attachmentKind("archive.zip")).toBeNull();
    expect(attachmentKind("slides.pptx")).toBeNull();
    expect(attachmentKind("noext")).toBeNull();
    expect(isSupportedName("archive.zip")).toBe(false);
    expect(isSupportedName("voice.wav")).toBe(true);
  });

  it("applies a per-type size limit", () => {
    expect(maxBytesFor("notes.txt")).toBe(MAX_FILE_BYTES);
    expect(maxBytesFor("book.xlsx")).toBe(MAX_FILE_BYTES);
    expect(maxBytesFor("deck.pdf")).toBe(MAX_PDF_BYTES);
    expect(maxBytesFor("shot.png")).toBe(MAX_IMAGE_BYTES);
    expect(maxBytesFor("voice.m4a")).toBe(MAX_AUDIO_BYTES);
    // Unknown types fall back to the smallest limit (they're rejected anyway).
    expect(maxBytesFor("archive.zip")).toBe(MAX_FILE_BYTES);
    // Every kind is capped at the hosting request-body limit (4 MB) today.
    expect(maxMbFor("notes.txt")).toBe(4);
    expect(maxMbFor("shot.png")).toBe(4);
    expect(maxMbFor("voice.m4a")).toBe(4);
    expect(MAX_AUDIO_BYTES).toBeLessThanOrEqual(4.5 * 1024 * 1024);
    expect(MAX_IMAGE_BYTES).toBeGreaterThanOrEqual(MAX_FILE_BYTES);
  });

  it("knows which kinds the Brain extracts vs local", () => {
    expect(isBrainExtractedKind("pdf")).toBe(true);
    expect(isBrainExtractedKind("image")).toBe(true);
    expect(isBrainExtractedKind("audio")).toBe(true);
    expect(isBrainExtractedKind("text")).toBe(false);
    expect(isBrainExtractedKind("sheet")).toBe(false);
    expect(isBrainExtractedKind(null)).toBe(false);
  });

  it("labels in-progress chips by kind", () => {
    expect(statusLabelFor("voice.m4a")).toBe("Transcribing…");
    expect(statusLabelFor("deck.pdf")).toBe("Reading PDF…");
    expect(statusLabelFor("shot.png")).toBe("Reading image…");
    expect(statusLabelFor("notes.txt")).toBe("Reading…");
  });

  it("the file input accepts the new kinds", () => {
    for (const s of [".pdf", ".png", ".m4a", "application/pdf", "image/*", "audio/*"]) {
      expect(ACCEPTED_ACCEPT.split(",")).toContain(s);
    }
  });
});

describe("taxonomy labels", () => {
  it("authority codes get their human label", () => {
    expect(authorityLabel("A1")).toBe("A1 · Current verified company truth");
    expect(authorityLabel("B1")).toBe("B1 · Approved PractiScale playbook");
    expect(authorityLabel("Z9")).toBe("Z9"); // unknown code: shown as-is
    expect(authorityLabel(null)).toBe("Unrated");
    expect(authorityLabel(undefined)).toBe("Unrated");
  });

  it("relationship / class / domain ids resolve to labels with a humanized fallback", () => {
    expect(relationshipLabel("supersedes")).toBe("supersedes");
    expect(relationshipLabel("used_playbook")).toBe("used the playbook");
    expect(relationshipLabel("some_new_type")).toBe("some new type");
    expect(classLabel("business_reality")).toBe("Business Reality");
    expect(classLabel(null)).toBe("Unclassified");
    expect(domainLabel("customer_success")).toBe("Customer Success");
    expect(domainLabel("brand_new")).toBe("Brand new");
    expect(humanize("manager_dependency")).toBe("Manager dependency");
  });

  it("builds the Ask-about-this prompt from ref + name", () => {
    expect(askPrompt("MG-001", "Source of Energy")).toContain('MG-001 "Source of Energy"');
    expect(askPrompt("MG-001", null)).toContain("MG-001");
  });
});

describe("chat data events", () => {
  it("parses a conflicts event and drops malformed pairs", () => {
    const pairs = parseConflictsEvent({
      type: "conflicts",
      pairs: [
        { a: { ref: "MG-001", name: "Source of Energy", authority: "B1" }, b: { ref: "MG-027", name: "Manager as Approver", authority: "C1" }, note: "superseded" },
        { a: { ref: "X-1" } }, // no b → dropped
        "garbage",
        { a: { name: "no ref" }, b: { ref: "Y-2" } }, // a has no ref → dropped
      ],
    });
    expect(pairs).toHaveLength(1);
    expect(pairs![0]).toEqual({
      a: { ref: "MG-001", name: "Source of Energy", authority: "B1" },
      b: { ref: "MG-027", name: "Manager as Approver", authority: "C1" },
      note: "superseded",
    });
    expect(conflictSentence(pairs![0])).toBe(
      "MG-001 disagrees with MG-027 — the Brain favoured the higher-authority, current source"
    );
  });

  it("returns null for other event types", () => {
    expect(parseConflictsEvent({ type: "sources", sources: [] })).toBeNull();
    expect(parseConflictsEvent({ type: "conflicts" })).toBeNull(); // no pairs array
    expect(parseConflictsEvent(null)).toBeNull();
    expect(parsePerformanceEvent({ type: "conflicts", pairs: [] })).toBeNull();
    expect(parsePerformanceEvent(undefined)).toBeNull();
  });

  it("parses a performance event with defaults for missing fields", () => {
    const metrics = parsePerformanceEvent({
      type: "performance",
      metrics: [
        { key: "close_rate", label: "Close rate", value: 0.38, unit: "%", period_start: "2026-01-01", period_end: "2026-03-31", dimensions: { team: "sales" }, source: "PM-001" },
        { key: "decisions_waiting", value: "4/week" },
        { label: "no key" }, // dropped
        { key: "bad_value", value: { nested: true }, dimensions: ["not", "an", "object"] },
      ],
    });
    expect(metrics).toHaveLength(3);
    expect(metrics![0]).toMatchObject({ key: "close_rate", label: "Close rate", value: 0.38, unit: "%", source: "PM-001", dimensions: { team: "sales" } });
    expect(metrics![1]).toMatchObject({ key: "decisions_waiting", label: "Decisions waiting", value: "4/week", unit: null, dimensions: null });
    expect(metrics![2]).toMatchObject({ key: "bad_value", value: null, dimensions: null });
  });

  it("formats metric values and periods", () => {
    expect(formatMetricValue({ value: 1234.567, unit: "calls" })).toBe("1,234.57 calls");
    expect(formatMetricValue({ value: "4/week", unit: null })).toBe("4/week");
    expect(formatMetricValue({ value: null, unit: "%" })).toBe("—");
    expect(formatPeriod(null, null)).toBe("");
    expect(formatPeriod("2026-01-01", "2026-03-31")).toMatch(/2026 – .*2026/);
    expect(formatPeriod("2026-01-01", null)).toMatch(/^from /);
    expect(formatPeriod(null, "2026-03-31")).toMatch(/^to /);
  });
});

import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_KIND_CAPABILITY,
  UI_CAPABILITY,
  acceptForKinds,
  acceptedLabelForKinds,
  capabilitySet,
  grantedAttachmentKinds,
  isAllowedAttachmentName,
} from "@/lib/capabilities-client";
import { ATTACHMENT_KIND_CAPABILITY as SERVER_KIND_CAPABILITY, canAttachKind } from "@/lib/access";
import { ACCEPTED_ACCEPT, ACCEPTED_EXT, ACCEPTED_LABEL } from "@/lib/attachments-shared";
import { BUILTIN_CAPABILITY_MANIFEST } from "@/lib/capabilities-shared";

const ALL_EXTRACT = ["extract.text", "extract.pdf", "extract.image", "extract.audio"];

describe("client capability gating", () => {
  it("maps attachment kinds exactly like the server's canAttachKind", () => {
    expect(ATTACHMENT_KIND_CAPABILITY).toEqual(SERVER_KIND_CAPABILITY);
    const caps = ["extract.pdf", "extract.audio"];
    for (const kind of Object.keys(ATTACHMENT_KIND_CAPABILITY)) {
      expect(grantedAttachmentKinds(capabilitySet(caps)).includes(kind as never)).toBe(canAttachKind(caps, kind));
    }
  });

  it("only gates on capability ids the manifest actually offers", () => {
    const ids = new Set(BUILTIN_CAPABILITY_MANIFEST.capabilities.map((c) => c.id));
    for (const id of [...Object.values(UI_CAPABILITY), ...Object.values(ATTACHMENT_KIND_CAPABILITY)]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("treats the resolved list as authoritative: nothing listed, nothing granted", () => {
    expect(capabilitySet(null).size).toBe(0);
    expect(capabilitySet(undefined).size).toBe(0);
    expect(grantedAttachmentKinds(capabilitySet([]))).toEqual([]);
    // extract.url / extract.youtube don't make anything attachable.
    expect(grantedAttachmentKinds(capabilitySet(["extract.url", "extract.youtube", "chat.knowledge"]))).toEqual([]);
    expect(acceptForKinds([])).toBe("");
    expect(acceptedLabelForKinds([])).toBe("");
  });

  it("text files cover spreadsheets; each other kind needs its own grant", () => {
    expect(grantedAttachmentKinds(capabilitySet(["extract.text"]))).toEqual(["text", "sheet"]);
    expect(grantedAttachmentKinds(capabilitySet(["extract.pdf"]))).toEqual(["pdf"]);
    expect(grantedAttachmentKinds(capabilitySet(ALL_EXTRACT))).toEqual(["text", "sheet", "pdf", "image", "audio"]);
  });

  it("limits the picker's accept list and label to the granted kinds", () => {
    const pdfOnly = acceptForKinds(["pdf"]).split(",");
    expect(pdfOnly).toEqual([".pdf", "application/pdf"]);
    expect(acceptedLabelForKinds(["pdf"])).toBe("PDF");

    const text = acceptForKinds(["text", "sheet"]).split(",");
    expect(text).toContain(".csv");
    expect(text).toContain(".xlsx");
    expect(text).not.toContain(".pdf");
    expect(text).not.toContain("image/*");
    expect(text).not.toContain("audio/*");
  });

  it("with every kind granted, matches the full accepted list", () => {
    const kinds = grantedAttachmentKinds(capabilitySet(ALL_EXTRACT));
    expect(new Set(acceptForKinds(kinds).split(","))).toEqual(new Set(ACCEPTED_ACCEPT.split(",")));
    expect(acceptedLabelForKinds(kinds)).toBe(ACCEPTED_LABEL);
    for (const ext of ACCEPTED_EXT) expect(isAllowedAttachmentName(`file${ext}`, kinds)).toBe(true);
  });

  it("rejects file names of kinds that aren't granted", () => {
    expect(isAllowedAttachmentName("notes.md", ["pdf"])).toBe(false);
    expect(isAllowedAttachmentName("deck.pdf", ["pdf"])).toBe(true);
    expect(isAllowedAttachmentName("memo.m4a", ["text", "sheet"])).toBe(false);
    expect(isAllowedAttachmentName("archive.zip", ["text", "sheet", "pdf", "image", "audio"])).toBe(false);
  });
});

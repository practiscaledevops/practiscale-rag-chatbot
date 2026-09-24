// Magic-byte check for uploads, shared by POST /api/attachments and
// POST /api/projects/files: does the file CONTENT match what its extension
// promises? A renamed file (an executable called report.pdf, a zip bomb called
// data.xlsx) is rejected before it reaches SheetJS or the Brain's extractor.
//
// Pure (no Node or DOM APIs beyond Uint8Array) so it is unit-testable.

/** Bytes to read for the signature check (the longest signature is 12 bytes). */
export const SNIFF_BYTES = 16;

/** Whether `head` carries `sig` at `offset`. */
export function hasBytes(head: Uint8Array, sig: number[], offset = 0): boolean {
  if (head.length < offset + sig.length) return false;
  return sig.every((b, i) => head[offset + i] === b);
}

/**
 * Only types with a fixed signature are checked; text (any bytes are "text"),
 * legacy .xls (several container formats) and audio (many containers) pass.
 * `ext` is lib/attachments-shared fileExt(name) (lower-case, with the dot).
 */
export function contentMatchesExtension(ext: string, head: Uint8Array): boolean {
  switch (ext) {
    case ".pdf":
      return hasBytes(head, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case ".xlsx":
      return hasBytes(head, [0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 (OOXML zip)
    case ".png":
      return hasBytes(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".jpg":
    case ".jpeg":
      return hasBytes(head, [0xff, 0xd8, 0xff]);
    case ".gif":
      return hasBytes(head, [0x47, 0x49, 0x46, 0x38]); // GIF8(7a|9a)
    case ".webp":
      // RIFF <size> WEBP
      return hasBytes(head, [0x52, 0x49, 0x46, 0x46]) && hasBytes(head, [0x57, 0x45, 0x42, 0x50], 8);
    default:
      return true;
  }
}

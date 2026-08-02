// Discord's attachment.contentType is sometimes wrong (e.g. a screenshot
// tool saves PNG bytes but the client reports/uploads it as image/webp, or
// vice versa) — Claude's vision API validates the declared media_type
// against the actual bytes and rejects a mismatch outright. Sniff the real
// format from the file's magic bytes instead of trusting the declared type.

const SIGNATURES = [
  { mediaType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mediaType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
];

/** Returns the real media type from a Buffer's magic bytes, or null if unrecognized. */
export function sniffMediaType(buffer) {
  for (const { mediaType, bytes } of SIGNATURES) {
    if (buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b)) return mediaType;
  }
  // WEBP: "RIFF" .... "WEBP" (bytes 0-3 and 8-11)
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

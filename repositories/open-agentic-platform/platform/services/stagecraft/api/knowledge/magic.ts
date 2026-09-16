// Spec 115 FR-014 — pure magic-number detector (no Encore-runtime imports
// so it can be exercised under plain `vitest run` without the native
// Encore extension).

const SNIFF_BYTES = 4096;

export const MAGIC_SNIFF_BYTES = SNIFF_BYTES;

export function detectMimeFromMagic(bytes: Buffer): string | null {
  if (bytes.length < 4) return null;

  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "application/zip";
  }

  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return "audio/mpeg";
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return "audio/wav";
  }

  let allPrintable = true;
  for (const b of bytes) {
    if (b === 0x00) {
      allPrintable = false;
      break;
    }
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) {
      allPrintable = false;
      break;
    }
  }
  if (allPrintable) {
    let i = 0;
    while (
      i < bytes.length &&
      (bytes[i] === 0x20 ||
        bytes[i] === 0x09 ||
        bytes[i] === 0x0a ||
        bytes[i] === 0x0d)
    ) {
      i++;
    }
    if (i < bytes.length && (bytes[i] === 0x7b || bytes[i] === 0x5b)) {
      return "application/json";
    }
    return "text/plain";
  }

  return null;
}

/**
 * Apply the spec-115 FR-014 reconciliation rules to the sniffed result.
 * Pure — does NOT touch S3. The caller hands in the bytes; this returns
 * the resolved mime + whether the answer differs from the declared type.
 */
export function reconcileSniffedMime(args: {
  declaredMime: string;
  sample: Buffer | null;
}): {
  mimeType: string;
  mismatched: boolean;
  sniffedAs: string | null;
} {
  if (!args.sample) {
    return { mimeType: args.declaredMime, mismatched: false, sniffedAs: null };
  }
  const sniffed = detectMimeFromMagic(args.sample);
  if (!sniffed) {
    return { mimeType: args.declaredMime, mismatched: false, sniffedAs: null };
  }
  const officeZip = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ];
  if (sniffed === "application/zip" && officeZip.includes(args.declaredMime)) {
    return {
      mimeType: args.declaredMime,
      mismatched: false,
      sniffedAs: sniffed,
    };
  }
  const textFamily = ["text/plain", "text/markdown", "application/json", "text/csv"];
  if (
    (sniffed === "text/plain" || sniffed === "application/json") &&
    textFamily.includes(args.declaredMime)
  ) {
    return {
      mimeType: args.declaredMime,
      mismatched: false,
      sniffedAs: sniffed,
    };
  }
  return {
    mimeType: sniffed,
    mismatched: sniffed !== args.declaredMime,
    sniffedAs: sniffed,
  };
}

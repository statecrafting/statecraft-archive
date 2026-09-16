// Spec 115 FR-014 — magic-number sniffing tests.
//
// The S3 dependency is exercised end-to-end in the soak test (Phase 4
// T071); this file pins the pure detector for every supported signature
// so a regression on the dispatch routing fails CI loudly.

import { describe, expect, test } from "vitest";
import { detectMimeFromMagic, reconcileSniffedMime } from "./magic";

function withSignature(prefix: number[], pad = 32): Buffer {
  const out = Buffer.alloc(prefix.length + pad);
  for (let i = 0; i < prefix.length; i++) out[i] = prefix[i];
  return out;
}

describe("detectMimeFromMagic", () => {
  test("PDF signature", () => {
    expect(detectMimeFromMagic(withSignature([0x25, 0x50, 0x44, 0x46]))).toBe(
      "application/pdf",
    );
  });

  test("PNG signature", () => {
    expect(
      detectMimeFromMagic(
        withSignature([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
  });

  test("JPEG signature", () => {
    expect(detectMimeFromMagic(withSignature([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
  });

  test("GIF signature", () => {
    expect(
      detectMimeFromMagic(withSignature([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
    ).toBe("image/gif");
  });

  test("WEBP signature", () => {
    const buf = Buffer.alloc(32);
    Buffer.from("RIFF").copy(buf, 0);
    buf.writeUInt32LE(20, 4);
    Buffer.from("WEBP").copy(buf, 8);
    expect(detectMimeFromMagic(buf)).toBe("image/webp");
  });

  test("ZIP signature (DOCX/XLSX/PPTX shape)", () => {
    expect(detectMimeFromMagic(withSignature([0x50, 0x4b, 0x03, 0x04]))).toBe(
      "application/zip",
    );
  });

  test("MP3 ID3 tag", () => {
    expect(detectMimeFromMagic(withSignature([0x49, 0x44, 0x33]))).toBe(
      "audio/mpeg",
    );
  });

  test("WAV signature", () => {
    const buf = Buffer.alloc(32);
    Buffer.from("RIFF").copy(buf, 0);
    buf.writeUInt32LE(20, 4);
    Buffer.from("WAVE").copy(buf, 8);
    expect(detectMimeFromMagic(buf)).toBe("audio/wav");
  });

  test("plain ASCII text", () => {
    expect(detectMimeFromMagic(Buffer.from("hello world"))).toBe("text/plain");
  });

  test("JSON detection (leading {)", () => {
    expect(detectMimeFromMagic(Buffer.from('  {"a": 1}'))).toBe(
      "application/json",
    );
  });

  test("JSON detection (leading [)", () => {
    expect(detectMimeFromMagic(Buffer.from("[1,2,3]"))).toBe("application/json");
  });

  test("binary content with NUL byte returns null", () => {
    const buf = Buffer.alloc(32);
    buf[0] = 0x12;
    buf[5] = 0x00;
    expect(detectMimeFromMagic(buf)).toBeNull();
  });

  test("empty / very short returns null", () => {
    expect(detectMimeFromMagic(Buffer.alloc(0))).toBeNull();
    expect(detectMimeFromMagic(Buffer.from([0x12]))).toBeNull();
  });
});

describe("reconcileSniffedMime", () => {
  test("returns declared when sample is null (object too small to sniff)", () => {
    expect(
      reconcileSniffedMime({ declaredMime: "text/plain", sample: null }),
    ).toEqual({
      mimeType: "text/plain",
      mismatched: false,
      sniffedAs: null,
    });
  });

  test("DOCX declared + ZIP-shaped sample = no mismatch (FR-014 office exception)", () => {
    const sample = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const r = reconcileSniffedMime({
      declaredMime:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sample,
    });
    expect(r.mismatched).toBe(false);
    expect(r.sniffedAs).toBe("application/zip");
    expect(r.mimeType).toContain("wordprocessingml");
  });

  test("text/markdown declared + ASCII sample = no mismatch (text-family exception)", () => {
    const r = reconcileSniffedMime({
      declaredMime: "text/markdown",
      sample: Buffer.from("# Heading\n\nbody"),
    });
    expect(r.mismatched).toBe(false);
    expect(r.mimeType).toBe("text/markdown");
  });

  test("PDF declared but PNG sample → sniffed wins, mismatch flagged", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const r = reconcileSniffedMime({
      declaredMime: "application/pdf",
      sample: png,
    });
    expect(r.mismatched).toBe(true);
    expect(r.mimeType).toBe("image/png");
    expect(r.sniffedAs).toBe("image/png");
  });
});

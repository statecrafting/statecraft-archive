// Spec 115 — pure-helper tests for the deterministic text extractor.
// The extractor's S3 dependency is exercised by the integration soak
// test (Phase 4 T071); pure decoding/line-counting lives here.

import { describe, expect, test } from "vitest";
import {
  countLines,
  decodeTextBytes,
} from "./deterministic-text-helpers";

describe("decodeTextBytes", () => {
  test("decodes plain UTF-8 without a BOM", () => {
    expect(decodeTextBytes(Buffer.from("hello"))).toBe("hello");
  });

  test("strips UTF-8 BOM", () => {
    const buf = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("hi"),
    ]);
    expect(decodeTextBytes(buf)).toBe("hi");
  });

  test("decodes UTF-16 LE BOM", () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("hi", "utf16le"),
    ]);
    expect(decodeTextBytes(buf)).toBe("hi");
  });

  test("decodes UTF-16 BE BOM", () => {
    // UTF-16 BE encoding of "hi"
    const buf = Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
    expect(decodeTextBytes(buf)).toBe("hi");
  });

  test("empty buffer returns empty string", () => {
    expect(decodeTextBytes(Buffer.alloc(0))).toBe("");
  });
});

describe("countLines", () => {
  test("0 for empty text", () => {
    expect(countLines("")).toBe(0);
  });

  test("1 for a single line with no newline", () => {
    expect(countLines("hello")).toBe(1);
  });

  test("3 for two newlines", () => {
    expect(countLines("a\nb\nc")).toBe(3);
  });

  test("handles CRLF and CR equivalently", () => {
    expect(countLines("a\r\nb\r\nc")).toBe(3);
    expect(countLines("a\rb\rc")).toBe(3);
  });
});

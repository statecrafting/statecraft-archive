// Feature: 070-prompt-assembly-cache

import { describe, it, expect } from "vitest";
import { CompactionService } from "./compaction.js";
import type { Message } from "./types.js";

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
    content: `Message ${i}: ${"x".repeat(100)}`,
  }));
}

describe("CompactionService", () => {
  describe("shouldCompact (FR-006)", () => {
    it("returns false when below threshold", () => {
      const svc = new CompactionService({ windowThreshold: 0.8 });
      const messages = makeMessages(5);
      // Small prompt + small messages, large window
      expect(svc.shouldCompact(1000, messages, 1_000_000)).toBe(false);
    });

    it("returns true when at or above threshold", () => {
      const svc = new CompactionService({ windowThreshold: 0.8 });
      const messages = makeMessages(5);
      // Make the window very small so we exceed threshold
      expect(svc.shouldCompact(800, messages, 1000)).toBe(true);
    });

    it("accounts for both prompt size and message size", () => {
      const svc = new CompactionService({ windowThreshold: 0.5 });
      // 500 byte prompt + messages, 2000 byte window, 50% threshold = 1000 threshold
      const messages = makeMessages(10); // ~1100 bytes
      expect(svc.shouldCompact(500, messages, 2000)).toBe(true);
    });

    it("respects custom threshold", () => {
      const svc = new CompactionService({ windowThreshold: 0.5 });
      // At 50% threshold on a 2000 byte window = 1000 bytes
      expect(svc.shouldCompact(600, makeMessages(1), 2000)).toBe(false);
      expect(svc.shouldCompact(900, makeMessages(3), 2000)).toBe(true);
    });
  });

  describe("compact (SC-004, R-002)", () => {
    it("keeps all messages when count <= keepRecent", () => {
      const svc = new CompactionService({ keepRecent: 10 });
      const messages = makeMessages(5);

      const result = svc.compact(messages);
      expect(result.compactedCount).toBe(0);
      expect(result.summary).toBe("");
      expect(result.keptMessages).toEqual(messages);
      expect(result.bytesSaved).toBe(0);
    });

    it("compacts older messages and keeps recent ones", () => {
      const svc = new CompactionService({ keepRecent: 3 });
      const messages = makeMessages(10);

      const result = svc.compact(messages);
      expect(result.compactedCount).toBe(7);
      expect(result.keptMessages).toHaveLength(3);
      // Kept messages should be the last 3
      expect(result.keptMessages[0]).toBe(messages[7]);
      expect(result.keptMessages[2]).toBe(messages[9]);
      expect(result.summary).toContain("Compacted 7 messages");
    });

    it("reports bytesSaved as non-negative", () => {
      const svc = new CompactionService({
        keepRecent: 2,
        summarizer: () => "Short summary",
      });
      const messages = makeMessages(20);

      const result = svc.compact(messages);
      expect(result.bytesSaved).toBeGreaterThan(0);
      expect(result.compactedCount).toBe(18);
    });

    it("uses custom summarizer", () => {
      const svc = new CompactionService({
        keepRecent: 2,
        summarizer: (msgs) => `Custom summary of ${msgs.length} messages`,
      });
      const messages = makeMessages(5);

      const result = svc.compact(messages);
      expect(result.summary).toBe("Custom summary of 3 messages");
    });

    it("handles exactly keepRecent messages (boundary case)", () => {
      const svc = new CompactionService({ keepRecent: 5 });
      const messages = makeMessages(5);

      const result = svc.compact(messages);
      expect(result.compactedCount).toBe(0);
      expect(result.keptMessages).toEqual(messages);
    });

    it("handles keepRecent + 1 messages", () => {
      const svc = new CompactionService({ keepRecent: 5 });
      const messages = makeMessages(6);

      const result = svc.compact(messages);
      expect(result.compactedCount).toBe(1);
      expect(result.keptMessages).toHaveLength(5);
    });
  });
});

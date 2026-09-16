import { describe, expect, it } from "vitest";
import { MemoryAuditSink, nullAuditSink } from "./audit.js";

describe("MemoryAuditSink", () => {
  it("captures audit entries", () => {
    const sink = new MemoryAuditSink();
    sink.log({
      eventType: "PreToolUse",
      hookName: "test-hook",
      handlerType: "bash",
      durationMs: 12,
      result: "allow",
      timestamp: Date.now(),
    });

    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].hookName).toBe("test-hook");
    expect(sink.entries[0].result).toBe("allow");
  });

  it("clears entries", () => {
    const sink = new MemoryAuditSink();
    sink.log({
      eventType: "SessionStart",
      hookName: "greet",
      handlerType: "prompt",
      durationMs: 0,
      result: "allow",
      timestamp: Date.now(),
    });

    sink.clear();
    expect(sink.entries).toHaveLength(0);
  });
});

describe("nullAuditSink", () => {
  it("does not throw", () => {
    expect(() =>
      nullAuditSink.log({
        eventType: "PreToolUse",
        hookName: "x",
        handlerType: "bash",
        durationMs: 0,
        result: "allow",
        timestamp: Date.now(),
      }),
    ).not.toThrow();
  });
});

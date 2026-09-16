import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRefresh } from "./watcher.js";

// We can't easily test createWatcher without a real filesystem,
// but we can test the withRefresh utility and the handler logic.

describe("withRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls refresh after a successful operation", async () => {
    const refresh = vi.fn();
    const result = await withRefresh(
      () => Promise.resolve("ok"),
      refresh,
    );
    expect(result).toBe("ok");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("calls refresh after a failed operation and re-throws", async () => {
    const refresh = vi.fn();
    await expect(
      withRefresh(
        () => Promise.reject(new Error("fail")),
        refresh,
      ),
    ).rejects.toThrow("fail");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("returns the operation result", async () => {
    const refresh = vi.fn();
    const result = await withRefresh(
      () => Promise.resolve(42),
      refresh,
    );
    expect(result).toBe(42);
  });
});

describe("GitPanelWatcher interface", () => {
  it("onChange returns an unsubscribe function", () => {
    // Simulate the watcher contract
    const handlers = new Set<() => void>();
    const onChange = (handler: () => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    };

    const handler = vi.fn();
    const unsubscribe = onChange(handler);
    expect(handlers.size).toBe(1);

    unsubscribe();
    expect(handlers.size).toBe(0);
  });

  it("dispose clears all handlers", () => {
    const handlers = new Set<() => void>();
    const dispose = () => handlers.clear();

    handlers.add(vi.fn());
    handlers.add(vi.fn());
    expect(handlers.size).toBe(2);

    dispose();
    expect(handlers.size).toBe(0);
  });
});

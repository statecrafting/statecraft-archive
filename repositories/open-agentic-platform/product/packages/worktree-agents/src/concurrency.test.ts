import { describe, expect, it } from "vitest";
import { FifoConcurrencyLimiter } from "./concurrency.js";

describe("FifoConcurrencyLimiter", () => {
  it("queues third acquire when max is two and starts on release", async () => {
    const limiter = new FifoConcurrencyLimiter(2);

    const releaseA = await limiter.acquire();
    const releaseB = await limiter.acquire();
    const thirdPromise = limiter.acquire();

    expect(limiter.getMetrics()).toEqual({
      maxConcurrent: 2,
      activeCount: 2,
      queuedCount: 1,
    });

    let thirdResolved = false;
    const thirdWrapped = thirdPromise.then((release) => {
      thirdResolved = true;
      return release;
    });

    await Promise.resolve();
    expect(thirdResolved).toBe(false);

    releaseA();
    const releaseC = await thirdWrapped;
    expect(thirdResolved).toBe(true);
    expect(limiter.getMetrics()).toEqual({
      maxConcurrent: 2,
      activeCount: 2,
      queuedCount: 0,
    });

    releaseB();
    releaseC();
    expect(limiter.getMetrics()).toEqual({
      maxConcurrent: 2,
      activeCount: 0,
      queuedCount: 0,
    });
  });

  it("preserves FIFO order across queued acquires", async () => {
    const limiter = new FifoConcurrencyLimiter(1);
    const started: string[] = [];

    const releaseFirst = await limiter.acquire();

    const second = limiter.acquire().then((release) => {
      started.push("second");
      return release;
    });
    const third = limiter.acquire().then((release) => {
      started.push("third");
      return release;
    });
    const fourth = limiter.acquire().then((release) => {
      started.push("fourth");
      return release;
    });

    expect(limiter.getMetrics().queuedCount).toBe(3);

    releaseFirst();
    const releaseSecond = await second;
    expect(started).toEqual(["second"]);

    releaseSecond();
    const releaseThird = await third;
    expect(started).toEqual(["second", "third"]);

    releaseThird();
    const releaseFourth = await fourth;
    expect(started).toEqual(["second", "third", "fourth"]);

    releaseFourth();
    expect(limiter.getMetrics()).toEqual({
      maxConcurrent: 1,
      activeCount: 0,
      queuedCount: 0,
    });
  });

  it("throws for invalid max concurrency", () => {
    expect(() => new FifoConcurrencyLimiter(0)).toThrow(
      /maxConcurrent must be a positive integer/,
    );
  });
});

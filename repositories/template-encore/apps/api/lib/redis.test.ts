import { afterEach, describe, expect, it } from "vitest";
import { isRedisConfigured, parseRedisHost } from "./redis";

const ORIGINAL = process.env.REDIS_HOST;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.REDIS_HOST;
  else process.env.REDIS_HOST = ORIGINAL;
});

describe("parseRedisHost (spec 018)", () => {
  it("defaults the port to 6379 when only a host is given", () => {
    expect(parseRedisHost("redis.internal")).toEqual({ host: "redis.internal", port: 6379 });
  });

  it("parses an explicit host:port", () => {
    expect(parseRedisHost("10.0.0.5:6380")).toEqual({ host: "10.0.0.5", port: 6380 });
  });

  it("falls back to 6379 when the port is not a finite number", () => {
    expect(parseRedisHost("redis:nope")).toEqual({ host: "redis", port: 6379 });
  });
});

describe("isRedisConfigured (spec 018 FR-002)", () => {
  it("is false when REDIS_HOST is unset", () => {
    delete process.env.REDIS_HOST;
    expect(isRedisConfigured()).toBe(false);
  });

  it("is false when REDIS_HOST is empty", () => {
    process.env.REDIS_HOST = "";
    expect(isRedisConfigured()).toBe(false);
  });

  it("is true when REDIS_HOST is set", () => {
    process.env.REDIS_HOST = "redis.internal:6379";
    expect(isRedisConfigured()).toBe(true);
  });
});

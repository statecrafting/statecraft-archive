// Spec 227: TTL semantics of the per-org create-catalog cache.

import { afterEach, describe, expect, test } from "vitest";
import {
  MODULE_CATALOG_CACHE_TTL_MS,
  clearModuleCatalogCache,
  getCachedForOrg,
} from "./moduleCatalogCache";

afterEach(() => clearModuleCatalogCache());

// The real cached value is the { modules, profiles } bundle; the cache is
// generic, so a small stand-in exercises the same TTL/per-org/clear semantics.
const bundle = (tag: string) => ({ modules: [tag], profiles: [] });

const NS = "create-catalog";

describe("getCachedForOrg", () => {
  test("loads once within the TTL window", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return bundle("data-redis");
    };
    let clock = 1_000;
    const now = () => clock;

    const first = await getCachedForOrg(NS, "org-1", load, now);
    clock += MODULE_CATALOG_CACHE_TTL_MS - 1;
    const second = await getCachedForOrg(NS, "org-1", load, now);

    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  test("reloads once the TTL has elapsed", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return bundle("data-redis");
    };
    let clock = 1_000;
    const now = () => clock;

    await getCachedForOrg(NS, "org-1", load, now);
    clock += MODULE_CATALOG_CACHE_TTL_MS;
    await getCachedForOrg(NS, "org-1", load, now);

    expect(calls).toBe(2);
  });

  test("caches per org id", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return bundle("x");
    };
    const now = () => 5_000;

    await getCachedForOrg(NS, "org-1", load, now);
    await getCachedForOrg(NS, "org-2", load, now);

    expect(calls).toBe(2);
  });

  test("different namespaces for the same org id do not collide", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return bundle("x");
    };
    const now = () => 5_000;

    const a = await getCachedForOrg("catalog", "org-1", load, now);
    const b = await getCachedForOrg("profiles", "org-1", load, now);

    expect(calls).toBe(2);
    expect(b).not.toBe(a);
  });

  test("clearModuleCatalogCache forces a reload", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return bundle("x");
    };
    const now = () => 5_000;

    await getCachedForOrg(NS, "org-1", load, now);
    clearModuleCatalogCache();
    await getCachedForOrg(NS, "org-1", load, now);

    expect(calls).toBe(2);
  });
});

import { describe, expect, test } from "vitest";
import {
  parseRefreshCookie,
  buildRefreshSetCookies,
} from "./refreshCookie-pure";
import type { RauthyTokens } from "./rauthy";

const tokens: RauthyTokens = {
  access_token: "ACCESS",
  refresh_token: "REFRESH",
  id_token: "ID",
  expires_in: 1800,
  token_type: "Bearer",
};

describe("parseRefreshCookie", () => {
  test("returns null when header is undefined", () => {
    expect(parseRefreshCookie(undefined)).toBeNull();
  });

  test("returns null when header is empty", () => {
    expect(parseRefreshCookie("")).toBeNull();
  });

  test("returns null when __refresh is absent", () => {
    expect(parseRefreshCookie("__session=abc; other=def")).toBeNull();
  });

  test("returns the value when __refresh is the only cookie", () => {
    expect(parseRefreshCookie("__refresh=tok123")).toBe("tok123");
  });

  test("returns the value when __refresh sits among other cookies", () => {
    expect(
      parseRefreshCookie("__session=abc; __refresh=tok123; foo=bar")
    ).toBe("tok123");
  });

  test("does not match a cookie whose name ends with __refresh as a suffix", () => {
    // The leading-boundary anchor `(?:^|;\s*)` prevents matching e.g. `x__refresh=...`.
    expect(parseRefreshCookie("x__refresh=tok123")).toBeNull();
  });
});

describe("buildRefreshSetCookies", () => {
  test("emits both cookies with secure=false (dev/test)", () => {
    const cookies = buildRefreshSetCookies(tokens, false);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toBe(
      "__session=ACCESS; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800;"
    );
    expect(cookies[1]).toBe(
      "__refresh=REFRESH; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600;"
    );
  });

  test("appends Secure when secure=true (production)", () => {
    const cookies = buildRefreshSetCookies(tokens, true);
    expect(cookies[0].endsWith(" Secure;")).toBe(true);
    expect(cookies[1].endsWith(" Secure;")).toBe(true);
  });

  test("clamps __session Max-Age to 14d when expires_in exceeds it", () => {
    const longLived: RauthyTokens = { ...tokens, expires_in: 30 * 24 * 60 * 60 };
    const cookies = buildRefreshSetCookies(longLived, false);
    expect(cookies[0]).toContain("Max-Age=1209600;");
  });

  test("__refresh Max-Age is always 14d, independent of expires_in", () => {
    const shortLived: RauthyTokens = { ...tokens, expires_in: 60 };
    const cookies = buildRefreshSetCookies(shortLived, false);
    expect(cookies[0]).toContain("Max-Age=60;");
    expect(cookies[1]).toContain("Max-Age=1209600;");
  });
});

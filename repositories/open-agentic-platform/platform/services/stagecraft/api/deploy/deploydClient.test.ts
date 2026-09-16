// Spec 215: deployd-api client diagnostics.
//
// describeTransportError unwraps undici's `err.cause` so a transport-level
// deploy failure records the real reason instead of a bare "fetch failed".

import { describe, expect, test } from "vitest";
import { describeTransportError } from "./deploydClient";

describe("describeTransportError", () => {
  test("unwraps an undici connection-refused cause", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = {
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 10.43.238.2:80",
    };
    expect(describeTransportError(err)).toBe(
      "fetch failed (ECONNREFUSED: connect ECONNREFUSED 10.43.238.2:80)",
    );
  });

  test("unwraps the headers-timeout cause (the helm --wait race)", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = {
      code: "UND_ERR_HEADERS_TIMEOUT",
      message: "Headers Timeout Error",
    };
    expect(describeTransportError(err)).toBe(
      "fetch failed (UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error)",
    );
  });

  test("falls back to the bare message when there is no cause", () => {
    expect(describeTransportError(new Error("boom"))).toBe("boom");
  });

  test("uses just the code when the cause carries no message", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = { code: "ENOTFOUND" };
    expect(describeTransportError(err)).toBe("fetch failed (ENOTFOUND)");
  });

  test("stringifies a non-Error value", () => {
    expect(describeTransportError("nope")).toBe("nope");
  });
});

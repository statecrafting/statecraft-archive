// Spec 143 FR-011 — upload-limit constants regression test.
//
// The size cap traverses three independent layers (browser pre-check,
// server-side requestUpload check, ingress body-size annotation).
// Drift between layers produces the "should never fire" 413 from
// nginx that FR-011 specifically calls out as a server-check
// regression. This test pins the canonical value so an accidental
// change to KNOWLEDGE_UPLOAD_MAX_BYTES fails CI loudly, with a
// reminder that the Helm chart annotation
// (`platform/charts/statecraft/values-hetzner.yaml`, FR-005) MUST
// be updated to match.

import { describe, expect, test } from "vitest";
import {
  KNOWLEDGE_UPLOAD_MAX_BYTES,
  KNOWLEDGE_UPLOAD_MAX_HUMAN,
} from "./uploadLimits";

describe("upload-limit constants (spec 143 FR-011)", () => {
  test("KNOWLEDGE_UPLOAD_MAX_BYTES is 1 GiB (1073741824 bytes)", () => {
    expect(KNOWLEDGE_UPLOAD_MAX_BYTES).toBe(1024 * 1024 * 1024);
    expect(KNOWLEDGE_UPLOAD_MAX_BYTES).toBe(1_073_741_824);
  });

  test("KNOWLEDGE_UPLOAD_MAX_HUMAN matches the byte value", () => {
    // The human-readable form is used in toasts and error messages.
    // The byte value above is the source of truth; this assertion
    // pins their relationship so they cannot drift.
    expect(KNOWLEDGE_UPLOAD_MAX_HUMAN).toBe("1 GiB");
    expect(KNOWLEDGE_UPLOAD_MAX_BYTES).toBe(1024 ** 3);
  });
});

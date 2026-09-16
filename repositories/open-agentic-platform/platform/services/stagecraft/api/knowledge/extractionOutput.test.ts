// Spec 115 FR-016 — `extraction_output` typed-contract validation tests.
//
// The Drizzle write path is wrapped with `validateExtractionOutput`; a
// malformed payload fails the run with `extractor_returned_malformed_output`.
// These tests pin every required field so a regression to the contract
// cannot ship without a corresponding test failure.

import { describe, expect, test } from "vitest";
import {
  ExtractorReturnedMalformedOutputError,
  extractionOutputDescriptor,
  type SchemaNode,
  validateExtractionOutput,
} from "./extractionOutput";

const MIN_VALID = {
  text: "hello world",
  metadata: {},
  extractor: { kind: "deterministic-text", version: "1" },
};

const FINGERPRINT = "a".repeat(64);

describe("validateExtractionOutput", () => {
  test("accepts the minimum valid shape", () => {
    const result = validateExtractionOutput(MIN_VALID);
    expect(result.text).toBe("hello world");
    expect(result.extractor.kind).toBe("deterministic-text");
  });

  test("accepts an agent-extracted payload with full agentRun", () => {
    const result = validateExtractionOutput({
      ...MIN_VALID,
      pages: [{ index: 0, text: "page 0" }],
      language: "en",
      outline: [{ level: 1, text: "Intro", pageIndex: 0 }],
      extractor: {
        kind: "agent-pdf-vision",
        version: "1",
        agentRun: {
          modelId: "claude-sonnet-4-6",
          promptFingerprint: FINGERPRINT,
          durationMs: 1200,
          tokenSpend: { input: 100, output: 200 },
          costUsd: 0.0123,
          attempts: 1,
        },
      },
    });
    expect(result.extractor.agentRun?.modelId).toBe("claude-sonnet-4-6");
  });

  test("rejects missing text", () => {
    expect(() =>
      validateExtractionOutput({
        metadata: {},
        extractor: { kind: "x", version: "1" },
      }),
    ).toThrow(ExtractorReturnedMalformedOutputError);
  });

  test("rejects missing extractor.kind", () => {
    expect(() =>
      validateExtractionOutput({
        text: "ok",
        metadata: {},
        extractor: { version: "1" },
      }),
    ).toThrow(ExtractorReturnedMalformedOutputError);
  });

  test("rejects malformed promptFingerprint", () => {
    expect(() =>
      validateExtractionOutput({
        ...MIN_VALID,
        extractor: {
          kind: "agent-pdf-vision",
          version: "1",
          agentRun: {
            modelId: "x",
            promptFingerprint: "not-hex",
            durationMs: 1,
            tokenSpend: { input: 1, output: 1 },
            costUsd: 0.001,
            attempts: 1,
          },
        },
      }),
    ).toThrow(ExtractorReturnedMalformedOutputError);
  });

  test("rejects negative token counts", () => {
    expect(() =>
      validateExtractionOutput({
        ...MIN_VALID,
        extractor: {
          kind: "agent-pdf-vision",
          version: "1",
          agentRun: {
            modelId: "x",
            promptFingerprint: FINGERPRINT,
            durationMs: 1,
            tokenSpend: { input: -1, output: 1 },
            costUsd: 0.001,
            attempts: 1,
          },
        },
      }),
    ).toThrow(ExtractorReturnedMalformedOutputError);
  });
});

// ---------------------------------------------------------------------------
// Spec 125 — descriptor↔validator consistency.
//
// The schema-parity gate (`make ci-schema-parity`) catches descriptor-↔-Rust
// drift; this block catches descriptor-↔-Validator drift. If the
// descriptor declares a field required and the validator does not enforce
// it (or vice versa), one of these tests fails. Together with the parity
// gate the two surfaces cover every direction of drift.
//
// The walker recurses through nested objects, array elements, tuple
// positions, and discriminated-union variants present in the baseline so
// every structural field the descriptor names is exercised. Enum fields
// (none today) are also probed with a never-valid value.
// ---------------------------------------------------------------------------

const FULLY_POPULATED = {
  text: "hello world",
  pages: [{ index: 0, text: "p1", bbox: { x: 0 } }],
  language: "en",
  outline: [{ level: 1, text: "intro", pageIndex: 0 }],
  metadata: {},
  extractor: {
    kind: "deterministic-text",
    version: "1",
    agentRun: {
      modelId: "claude-sonnet-4-6",
      promptFingerprint: FINGERPRINT,
      durationMs: 1,
      tokenSpend: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0.001,
      attempts: 1,
    },
  },
} as const;

type FieldCase = {
  path: (string | number)[];
  required: boolean;
  type: SchemaNode;
};

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

function getAtPath(obj: unknown, path: (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k as string | number];
  }
  return cur;
}

function deleteAtPath(obj: unknown, path: (string | number)[]): void {
  if (path.length === 0) return;
  let cur: unknown = obj;
  for (let i = 0; i < path.length - 1; i++) {
    cur = (cur as Record<string | number, unknown>)[path[i] as string | number];
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur) && typeof last === "number") {
    cur.splice(last, 1);
  } else {
    delete (cur as Record<string, unknown>)[last as string];
  }
}

function setAtPath(
  obj: unknown,
  path: (string | number)[],
  value: unknown,
): void {
  let cur: unknown = obj;
  for (let i = 0; i < path.length - 1; i++) {
    cur = (cur as Record<string | number, unknown>)[path[i] as string | number];
  }
  (cur as Record<string | number, unknown>)[
    path[path.length - 1] as string | number
  ] = value;
}

function collectFieldCases(
  node: SchemaNode,
  pathPrefix: (string | number)[],
  payload: unknown,
  out: FieldCase[],
): void {
  if (node.kind === "object") {
    for (const field of node.fields) {
      const fieldPath = [...pathPrefix, field.name];
      out.push({ path: fieldPath, required: field.required, type: field.type });
      const child = getAtPath(payload, fieldPath);
      if (child === undefined) continue;
      if (field.type.kind === "object") {
        collectFieldCases(field.type, fieldPath, payload, out);
      } else if (
        field.type.kind === "array" &&
        Array.isArray(child) &&
        child.length > 0 &&
        field.type.element.kind === "object"
      ) {
        collectFieldCases(field.type.element, [...fieldPath, 0], payload, out);
      } else if (field.type.kind === "tuple" && Array.isArray(child)) {
        field.type.items.forEach((itemType, i) => {
          if (itemType.kind === "object") {
            collectFieldCases(itemType, [...fieldPath, i], payload, out);
          }
        });
      } else if (field.type.kind === "discriminatedUnion") {
        const tagValue = (child as Record<string, unknown>)[
          field.type.discriminator
        ];
        const variant = field.type.variants.find((v) => v.tag === tagValue);
        if (variant) {
          for (const vf of variant.fields) {
            const vfPath = [...fieldPath, vf.name];
            out.push({
              path: vfPath,
              required: vf.required,
              type: vf.type,
            });
            const vChild = getAtPath(payload, vfPath);
            if (vChild !== undefined && vf.type.kind === "object") {
              collectFieldCases(vf.type, vfPath, payload, out);
            }
          }
        }
      }
    }
  }
}

const fieldCases: FieldCase[] = [];
collectFieldCases(extractionOutputDescriptor, [], FULLY_POPULATED, fieldCases);

describe("extractionOutputDescriptor consistency", () => {
  test("fully-populated baseline passes the validator", () => {
    expect(() =>
      validateExtractionOutput(clone(FULLY_POPULATED)),
    ).not.toThrow();
  });

  test("descriptor walk surfaces a non-trivial number of cases", () => {
    // Drift guard: if the descriptor or the baseline shrinks unexpectedly,
    // the consistency block stops covering the surface it claims to cover.
    expect(fieldCases.length).toBeGreaterThan(10);
  });

  for (const fc of fieldCases) {
    const pathLabel = fc.path.map(String).join(".") || "<root>";

    if (fc.required) {
      test(`required field "${pathLabel}" → validator rejects when removed`, () => {
        const variant = clone(FULLY_POPULATED) as Record<string, unknown>;
        deleteAtPath(variant, fc.path);
        expect(() => validateExtractionOutput(variant)).toThrow(
          ExtractorReturnedMalformedOutputError,
        );
      });
    } else {
      test(`optional field "${pathLabel}" → validator accepts when removed`, () => {
        const variant = clone(FULLY_POPULATED) as Record<string, unknown>;
        deleteAtPath(variant, fc.path);
        expect(() => validateExtractionOutput(variant)).not.toThrow();
      });
    }

    if (fc.type.kind === "enum") {
      const sentinel = "__never_a_valid_enum_value__";
      test(`enum field "${pathLabel}" → validator rejects out-of-set value`, () => {
        const variant = clone(FULLY_POPULATED) as Record<string, unknown>;
        setAtPath(variant, fc.path, sentinel);
        expect(() => validateExtractionOutput(variant)).toThrow(
          ExtractorReturnedMalformedOutputError,
        );
      });
    }
  }
});

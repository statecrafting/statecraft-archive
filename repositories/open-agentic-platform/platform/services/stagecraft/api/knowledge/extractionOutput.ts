// Spec 115 FR-016 — typed contract for `knowledge_objects.extraction_output`.
//
// Postgres JSONB cannot enforce this shape cheaply, so the worker validates
// at write time. A malformed payload fails the run with
// `extractor_returned_malformed_output` rather than silently corrupting the
// project's knowledge corpus.
//
// Hand-rolled validator (no zod). Encore.ts's TypeScript parser walks
// imported package `.d.ts` for type resolution and crashes on
// `node_modules/zod/v4/classic/schemas.d.cts` (`unsupported:
// TsFnOrConstructorType` on function-types-in-type-positions). Every zod 4
// import style triggers it, and the same hostility applies to `zod/mini`.
// Plain TS interfaces + a small validator keep Encore's parse path free
// of zod and let Encore's own runtime type-checking validate the API
// surface for typed handlers.

// Spec 120 FR-002 — shared schema version, mirrored verbatim by
// `KNOWLEDGE_SCHEMA_VERSION` in `crates/factory-contracts/src/knowledge.rs`.
// Drift is a CI failure (see `tools/schema-parity-check`).
export const KNOWLEDGE_SCHEMA_VERSION = "1.0.0" as const;

// Spec 120 FR-016(d) — minimum schema version the external
// `extraction-output` endpoint accepts. OPC sets the
// `X-Knowledge-Schema-Version` request header from its compile-time
// `KNOWLEDGE_SCHEMA_VERSION` const; bodies below this minimum are rejected
// with `failed_precondition` / `schema_version_too_old`.
export const MINIMUM_KNOWLEDGE_SCHEMA_VERSION = "1.0.0" as const;
export const KNOWLEDGE_SCHEMA_VERSION_HEADER = "x-knowledge-schema-version";

// ---------------------------------------------------------------------------
// Schema descriptor (spec 125)
// ---------------------------------------------------------------------------
//
// `SchemaNode` is the plain-data structural shape consumed by the
// `tools/schema-parity-check` walker. It mirrors the variant set the Rust
// fingerprint emitter in `crates/factory-contracts/src/knowledge.rs`
// produces, so a TS descriptor walked through the parity tool yields a
// fingerprint string-equal to the Rust one when the schemas agree.
//
// Co-located here (T001 option a) rather than in a shared package so the
// descriptor sits beside the `Validator` it describes — drift between the
// two is caught locally by the in-file vitest case (Phase 2). The parity
// tool stays dependency-free: it imports this file at runtime via Bun's
// TS loader and walks the descriptor structurally.
//
// Structural-only by design. Value-shape constraints the validator
// additionally enforces (HEX_64, Number.isInteger, min/max length, finite
// numbers) live in `Validator` and are exercised by unit tests, not by
// the parity gate.
export type SchemaNode =
  | { kind: "string" }
  | { kind: "int" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "unknown" }
  | { kind: "enum"; values: string[] }
  | { kind: "array"; element: SchemaNode }
  | { kind: "tuple"; items: SchemaNode[] }
  | { kind: "map"; key: SchemaNode; value: SchemaNode }
  | {
      kind: "object";
      fields: Array<{ name: string; required: boolean; type: SchemaNode }>;
    }
  | {
      kind: "discriminatedUnion";
      discriminator: string;
      variants: Array<{
        tag: string;
        fields: Array<{ name: string; required: boolean; type: SchemaNode }>;
      }>;
    };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TokenSpend {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface AgentRun {
  modelId: string;
  // sha256 hex of the prompt template + key params; reproducible across runs.
  promptFingerprint: string;
  durationMs: number;
  tokenSpend: TokenSpend;
  costUsd: number;
  attempts: number;
}

export interface ExtractionPage {
  index: number;
  text: string;
  bbox?: unknown;
}

export interface OutlineEntry {
  level: number;
  text: string;
  pageIndex?: number;
}

export interface ExtractorMeta {
  kind: string;
  version: string;
  agentRun?: AgentRun;
}

export interface ExtractionOutput {
  text: string;
  pages?: ExtractionPage[];
  // ISO 639-1 (e.g. "en", "fr"). Optional — many short payloads are unsafe
  // to language-detect.
  language?: string;
  outline?: OutlineEntry[];
  metadata: Record<string, unknown>;
  extractor: ExtractorMeta;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ExtractionOutputIssue {
  path: (string | number)[];
  message: string;
}

export class ExtractorReturnedMalformedOutputError extends Error {
  readonly code = "extractor_returned_malformed_output";
  readonly issues: ExtractionOutputIssue[];
  constructor(issues: ExtractionOutputIssue[]) {
    super(
      `extractor returned malformed output: ${issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
    );
    this.issues = issues;
  }
}

const HEX_64 = /^[a-f0-9]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Validator {
  readonly issues: ExtractionOutputIssue[] = [];
  private path: (string | number)[] = [];

  fail(message: string): void {
    this.issues.push({ path: [...this.path], message });
  }

  enter<T>(segment: string | number, fn: () => T): T {
    this.path.push(segment);
    try {
      return fn();
    } finally {
      this.path.pop();
    }
  }

  requireString(value: unknown, opts: { min?: number; max?: number } = {}): boolean {
    if (typeof value !== "string") {
      this.fail("expected string");
      return false;
    }
    if (opts.min !== undefined && value.length < opts.min) {
      this.fail(`string shorter than ${opts.min}`);
      return false;
    }
    if (opts.max !== undefined && value.length > opts.max) {
      this.fail(`string longer than ${opts.max}`);
      return false;
    }
    return true;
  }

  requireInt(
    value: unknown,
    opts: { nonneg?: boolean; positive?: boolean } = {},
  ): boolean {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      this.fail("expected integer");
      return false;
    }
    if (opts.positive && value <= 0) {
      this.fail("expected positive integer");
      return false;
    }
    if (opts.nonneg && value < 0) {
      this.fail("expected nonnegative integer");
      return false;
    }
    return true;
  }

  requireNumber(value: unknown, opts: { nonneg?: boolean } = {}): boolean {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.fail("expected finite number");
      return false;
    }
    if (opts.nonneg && value < 0) {
      this.fail("expected nonnegative number");
      return false;
    }
    return true;
  }

  requireObject(value: unknown): value is Record<string, unknown> {
    if (!isObject(value)) {
      this.fail("expected object");
      return false;
    }
    return true;
  }
}

function validateTokenSpend(v: Validator, value: unknown): void {
  if (!v.requireObject(value)) return;
  v.enter("input", () => v.requireInt(value.input, { nonneg: true }));
  v.enter("output", () => v.requireInt(value.output, { nonneg: true }));
  if (value.cacheRead !== undefined) {
    v.enter("cacheRead", () => v.requireInt(value.cacheRead, { nonneg: true }));
  }
  if (value.cacheWrite !== undefined) {
    v.enter("cacheWrite", () => v.requireInt(value.cacheWrite, { nonneg: true }));
  }
}

function validateAgentRun(v: Validator, value: unknown): void {
  if (!v.requireObject(value)) return;
  v.enter("modelId", () => v.requireString(value.modelId, { min: 1 }));
  v.enter("promptFingerprint", () => {
    if (!v.requireString(value.promptFingerprint)) return;
    if (!HEX_64.test(value.promptFingerprint as string)) {
      v.fail("expected sha256 hex (64 lowercase hex chars)");
    }
  });
  v.enter("durationMs", () => v.requireInt(value.durationMs, { nonneg: true }));
  v.enter("tokenSpend", () => validateTokenSpend(v, value.tokenSpend));
  v.enter("costUsd", () => v.requireNumber(value.costUsd, { nonneg: true }));
  v.enter("attempts", () => v.requireInt(value.attempts, { positive: true }));
}

function validatePage(v: Validator, value: unknown): void {
  if (!v.requireObject(value)) return;
  v.enter("index", () => v.requireInt(value.index, { nonneg: true }));
  v.enter("text", () => v.requireString(value.text));
  // bbox is `unknown` — no shape check
}

function validateOutlineEntry(v: Validator, value: unknown): void {
  if (!v.requireObject(value)) return;
  v.enter("level", () => v.requireInt(value.level, { positive: true }));
  v.enter("text", () => v.requireString(value.text, { min: 1 }));
  if (value.pageIndex !== undefined) {
    v.enter("pageIndex", () => v.requireInt(value.pageIndex, { nonneg: true }));
  }
}

function validateExtractor(v: Validator, value: unknown): void {
  if (!v.requireObject(value)) return;
  v.enter("kind", () => v.requireString(value.kind, { min: 1 }));
  v.enter("version", () => v.requireString(value.version, { min: 1 }));
  if (value.agentRun !== undefined) {
    v.enter("agentRun", () => validateAgentRun(v, value.agentRun));
  }
}

export function validateExtractionOutput(value: unknown): ExtractionOutput {
  const v = new Validator();

  if (!v.requireObject(value)) {
    throw new ExtractorReturnedMalformedOutputError(v.issues);
  }

  v.enter("text", () => v.requireString(value.text));

  if (value.pages !== undefined) {
    v.enter("pages", () => {
      if (!Array.isArray(value.pages)) {
        v.fail("expected array");
        return;
      }
      value.pages.forEach((p, i) => v.enter(i, () => validatePage(v, p)));
    });
  }

  if (value.language !== undefined) {
    v.enter("language", () =>
      v.requireString(value.language, { min: 2, max: 8 }),
    );
  }

  if (value.outline !== undefined) {
    v.enter("outline", () => {
      if (!Array.isArray(value.outline)) {
        v.fail("expected array");
        return;
      }
      value.outline.forEach((entry, i) =>
        v.enter(i, () => validateOutlineEntry(v, entry)),
      );
    });
  }

  v.enter("metadata", () => {
    if (!isObject(value.metadata)) {
      v.fail("expected object");
    }
  });

  v.enter("extractor", () => validateExtractor(v, value.extractor));

  if (v.issues.length > 0) {
    throw new ExtractorReturnedMalformedOutputError(v.issues);
  }

  return value as unknown as ExtractionOutput;
}

// ---------------------------------------------------------------------------
// Descriptor (spec 125)
// ---------------------------------------------------------------------------
//
// Plain-data structural mirror of what `validateExtractionOutput` accepts.
// Consumed by `tools/schema-parity-check` (which can no longer walk a zod
// tree because zod is not safe to import from this file — Encore.ts's TS
// parser crashes on `zod/v4/classic/schemas.d.cts`, see file header).
//
// The descriptor records *structure only*: field names, required vs.
// optional, and a small set of structural kinds (string | int | number |
// boolean | unknown | enum | array | tuple | map | object |
// discriminatedUnion). Value-shape constraints the `Validator` additionally
// enforces — `HEX_64` regex, length min/max, `Number.isInteger`,
// `Number.isFinite`, positive vs. nonneg, and so on — are NOT carried in
// the descriptor. Those checks are unit-tested via `validateExtractionOutput`
// itself; the parity gate's job is structural drift between TS and the
// Rust mirror in `crates/factory-contracts/src/knowledge.rs` only.
//
// Field order within each `object`'s `fields` array is alphabetical so the
// fingerprint emitted by the descriptor walker is order-independent and
// matches the Rust side (which sorts identically).

// note: validator additionally enforces nonneg on every int field
// (requireInt with `nonneg`/`positive` opts); the descriptor records the
// kind only.
const tokenSpendDescriptor: SchemaNode = {
  kind: "object",
  fields: [
    { name: "cacheRead", required: false, type: { kind: "int" } },
    { name: "cacheWrite", required: false, type: { kind: "int" } },
    { name: "input", required: true, type: { kind: "int" } },
    { name: "output", required: true, type: { kind: "int" } },
  ],
};

const agentRunDescriptor: SchemaNode = {
  kind: "object",
  fields: [
    // note: validator additionally enforces positive (> 0).
    { name: "attempts", required: true, type: { kind: "int" } },
    // note: validator additionally enforces nonneg + Number.isFinite.
    { name: "costUsd", required: true, type: { kind: "number" } },
    // note: validator additionally enforces nonneg.
    { name: "durationMs", required: true, type: { kind: "int" } },
    // note: validator additionally enforces non-empty string (min: 1).
    { name: "modelId", required: true, type: { kind: "string" } },
    // note: validator additionally enforces sha256 hex (HEX_64: 64 lowercase
    // hex chars).
    { name: "promptFingerprint", required: true, type: { kind: "string" } },
    { name: "tokenSpend", required: true, type: tokenSpendDescriptor },
  ],
};

const extractorDescriptor: SchemaNode = {
  kind: "object",
  fields: [
    { name: "agentRun", required: false, type: agentRunDescriptor },
    // note: validator additionally enforces non-empty string (min: 1).
    { name: "kind", required: true, type: { kind: "string" } },
    // note: validator additionally enforces non-empty string (min: 1).
    { name: "version", required: true, type: { kind: "string" } },
  ],
};

const pageDescriptor: SchemaNode = {
  kind: "object",
  fields: [
    // note: validator does not introspect bbox shape; any value is accepted.
    { name: "bbox", required: false, type: { kind: "unknown" } },
    // note: validator additionally enforces nonneg.
    { name: "index", required: true, type: { kind: "int" } },
    { name: "text", required: true, type: { kind: "string" } },
  ],
};

const outlineEntryDescriptor: SchemaNode = {
  kind: "object",
  fields: [
    // note: validator additionally enforces positive (> 0).
    { name: "level", required: true, type: { kind: "int" } },
    // note: validator additionally enforces nonneg.
    { name: "pageIndex", required: false, type: { kind: "int" } },
    // note: validator additionally enforces non-empty string (min: 1).
    { name: "text", required: true, type: { kind: "string" } },
  ],
};

export const extractionOutputDescriptor: SchemaNode = {
  kind: "object",
  fields: [
    { name: "extractor", required: true, type: extractorDescriptor },
    // note: validator additionally enforces 2..=8 character length on
    // ISO 639-1 codes.
    { name: "language", required: false, type: { kind: "string" } },
    // The validator only requires `metadata` to be an object; the Rust
    // mirror serialises it as `HashMap<String, Value>`. The map descriptor
    // matches the Rust fingerprint shape.
    {
      name: "metadata",
      required: true,
      type: {
        kind: "map",
        key: { kind: "string" },
        value: { kind: "unknown" },
      },
    },
    {
      name: "outline",
      required: false,
      type: { kind: "array", element: outlineEntryDescriptor },
    },
    {
      name: "pages",
      required: false,
      type: { kind: "array", element: pageDescriptor },
    },
    { name: "text", required: true, type: { kind: "string" } },
  ],
};

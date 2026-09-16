// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/125-schema-parity-walker-rebuild/spec.md — §3.2 (Phase 3 / T030)
//
// Schema descriptor walker.
//
// Maps a `SchemaNode` (the plain-data structural type co-located with each
// hand-rolled validator — see
// `platform/services/statecraft/api/knowledge/extractionOutput.ts`) to the
// fingerprint shape consumed by `tools/schema-parity-check/index.mjs` and
// emitted by the Rust mirror in `crates/factory-contracts/`. This is the
// only walker the parity tool carries — the zod walker that once lived
// alongside it was removed in spec 125 Phase 6 once specs 121 / 122 had
// shipped without authoring their reserved TS mirrors. Any future TS
// mirror landed at one of those paths MUST export a `SchemaNode`
// descriptor.
//
// Structural-only by design: value-shape constraints (regex, length bounds,
// finiteness, sign) are NOT carried through the fingerprint. Those are the
// validator's job and are exercised by the in-file consistency vitest case
// next to each descriptor (spec 125 §3.3).

/**
 * Walk a `SchemaNode` and produce the canonical fingerprint sub-tree.
 *
 * Field lists in `object` and per-variant fields in `discriminatedUnion`
 * are sorted alphabetically by name; enum values and discriminated-union
 * variants are sorted lexicographically. Tuple `items` preserve positional
 * order (tuples are positional, not alphabetical). This matches what the
 * Rust fingerprint emitter does in
 * `crates/factory-contracts/src/knowledge.rs`.
 *
 * Throws on a malformed or unrecognised node so a descriptor authoring bug
 * fails loudly at the parity gate rather than silently passing.
 */
export function walkDescriptor(node) {
  if (!node || typeof node !== "object" || typeof node.kind !== "string") {
    throw new Error(
      `walkDescriptor: malformed node — expected an object with a string \`kind\`, got ${JSON.stringify(node)}`,
    );
  }
  switch (node.kind) {
    case "string":
    case "int":
    case "number":
    case "boolean":
    case "unknown":
      return { kind: node.kind };
    case "enum": {
      const values = [...(node.values ?? [])].sort();
      return { kind: "enum", values };
    }
    case "array":
      return { kind: "array", element: walkDescriptor(node.element) };
    case "tuple":
      return {
        kind: "tuple",
        items: (node.items ?? []).map((item) => walkDescriptor(item)),
      };
    case "map":
      return {
        kind: "map",
        key: walkDescriptor(node.key),
        value: walkDescriptor(node.value),
      };
    case "object": {
      const fields = (node.fields ?? [])
        .map((f) => ({
          name: f.name,
          required: !!f.required,
          type: walkDescriptor(f.type),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { kind: "object", fields };
    }
    case "discriminatedUnion": {
      const variants = (node.variants ?? [])
        .map((v) => ({
          tag: v.tag,
          fields: (v.fields ?? [])
            .map((f) => ({
              name: f.name,
              required: !!f.required,
              type: walkDescriptor(f.type),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => String(a.tag).localeCompare(String(b.tag)));
      return {
        kind: "discriminatedUnion",
        discriminator: node.discriminator,
        variants,
      };
    }
    default:
      throw new Error(
        `walkDescriptor: unhandled descriptor kind: ${node.kind}`,
      );
  }
}

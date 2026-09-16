// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Per-tool JSON-Schema strictness validation (spec 169).
//!
//! OWASP ASI02 (Tool Misuse & Exploitation) prescribes
//! *"Schema validation, strong typing, and transactional write
//! guardrails"* as its core mitigation. The tool-registry rejects any
//! `ToolDef` registration whose schema is permissive, surfacing the
//! specific pattern that triggered the rejection.
//!
//! Permissive patterns (FR-001, FR-004 — recursive):
//!
//! 1. `additionalProperties: true` on an `object` parameter.
//! 2. `type: "any"` anywhere in the schema.
//! 3. An `object` parameter without `properties:` declared.
//! 4. A `oneOf` / `anyOf` branch matching any of (1)–(3).
//! 5. A `$ref` resolving to a schema matching any of (1)–(3).
//!
//! The validator descends into `properties`, `items`, `oneOf`, `anyOf`,
//! `allOf`, and resolves local `$ref` pointers (`#/$defs/...`,
//! `#/definitions/...`). External `$ref` resolution is out of scope —
//! schemas with non-local refs fail strict validation by structure.

use std::fmt;

use serde_json::Value;

/// A specific permissive pattern detected in a schema, used for
/// targeted diagnostics (SC-002: the warning identifies the crate,
/// tool name, and specific permissive pattern).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissivePattern {
    /// `additionalProperties: true` on an object.
    AdditionalPropertiesTrue { json_pointer: String },
    /// `type: "any"` declared explicitly.
    TypeAny { json_pointer: String },
    /// `object` parameter without `properties:` (and no
    /// `additionalProperties` constraint shrinking it).
    ObjectWithoutProperties { json_pointer: String },
    /// External `$ref` — unresolvable here; structurally permissive
    /// because the validator cannot prove strictness.
    UnresolvableRef {
        json_pointer: String,
        target: String,
    },
}

impl PermissivePattern {
    pub fn pointer(&self) -> &str {
        match self {
            Self::AdditionalPropertiesTrue { json_pointer, .. }
            | Self::TypeAny { json_pointer, .. }
            | Self::ObjectWithoutProperties { json_pointer, .. }
            | Self::UnresolvableRef { json_pointer, .. } => json_pointer,
        }
    }

    /// Short human-readable label (used in error messages and logs).
    pub fn label(&self) -> &'static str {
        match self {
            Self::AdditionalPropertiesTrue { .. } => "additionalProperties:true",
            Self::TypeAny { .. } => "type:any",
            Self::ObjectWithoutProperties { .. } => "object-without-properties",
            Self::UnresolvableRef { .. } => "unresolvable-$ref",
        }
    }
}

impl fmt::Display for PermissivePattern {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AdditionalPropertiesTrue { json_pointer } => {
                write!(f, "{} at {}", self.label(), json_pointer)
            }
            Self::TypeAny { json_pointer } => write!(f, "{} at {}", self.label(), json_pointer),
            Self::ObjectWithoutProperties { json_pointer } => {
                write!(f, "{} at {}", self.label(), json_pointer)
            }
            Self::UnresolvableRef {
                json_pointer,
                target,
            } => {
                write!(
                    f,
                    "{} '{}' at {}",
                    self.label(),
                    target,
                    json_pointer
                )
            }
        }
    }
}

/// Validate that `schema` is *strict* — i.e., contains none of the
/// permissive patterns enumerated in [`PermissivePattern`].
///
/// Returns `Ok(())` if strict, `Err(pattern)` naming the first
/// permissive pattern found (depth-first, descending into `properties`,
/// `items`, `oneOf`, `anyOf`, `allOf`, and local `$ref` resolution).
pub fn validate_strict_schema(schema: &Value) -> Result<(), PermissivePattern> {
    let mut visited: Vec<String> = Vec::new();
    walk(schema, schema, "", &mut visited)
}

fn walk(
    root: &Value,
    node: &Value,
    pointer: &str,
    visited: &mut Vec<String>,
) -> Result<(), PermissivePattern> {
    let Some(obj) = node.as_object() else {
        return Ok(());
    };

    // (5) Local `$ref` resolution — descend into the referenced schema.
    if let Some(reference) = obj.get("$ref").and_then(|v| v.as_str()) {
        if let Some(stripped) = reference.strip_prefix("#/") {
            let target = format!("/{}", stripped);
            if visited.contains(&target) {
                // Cycle — treat as already-validated.
                return Ok(());
            }
            visited.push(target.clone());
            if let Some(resolved) = resolve_local_ref(root, stripped) {
                let result = walk(root, resolved, &target, visited);
                visited.pop();
                return result;
            }
            visited.pop();
            return Err(PermissivePattern::UnresolvableRef {
                json_pointer: pointer.to_owned(),
                target: reference.to_owned(),
            });
        }
        // Non-local $ref (e.g. HTTP, file). Refuse — we cannot prove
        // strictness without external resolution.
        return Err(PermissivePattern::UnresolvableRef {
            json_pointer: pointer.to_owned(),
            target: reference.to_owned(),
        });
    }

    // (2) `type: "any"` anywhere.
    if let Some(ty) = obj.get("type") {
        if let Some(s) = ty.as_str() {
            if s == "any" {
                return Err(PermissivePattern::TypeAny {
                    json_pointer: pointer.to_owned(),
                });
            }
        } else if let Some(arr) = ty.as_array() {
            for (i, v) in arr.iter().enumerate() {
                if v.as_str() == Some("any") {
                    return Err(PermissivePattern::TypeAny {
                        json_pointer: format!("{}/type/{}", pointer, i),
                    });
                }
            }
        }
    }

    // (1) `additionalProperties: true` — direct, on any node (only meaningful
    // for objects, but the keyword could appear on a sibling-typed schema).
    if let Some(ap) = obj.get("additionalProperties")
        && ap.as_bool() == Some(true)
    {
        return Err(PermissivePattern::AdditionalPropertiesTrue {
            json_pointer: format!("{}/additionalProperties", pointer),
        });
    }

    // (3) Object without properties — only for nodes that explicitly declare
    // `type: "object"`. We do not require properties on schemas without a
    // declared type (those may be intentional polymorphism — handled by
    // oneOf/anyOf branches independently).
    let declared_type = obj.get("type").and_then(|v| v.as_str());
    if declared_type == Some("object") {
        let has_properties = obj
            .get("properties")
            .map(|v| v.is_object() && !v.as_object().unwrap().is_empty())
            .unwrap_or(false);
        let has_pattern_properties = obj
            .get("patternProperties")
            .map(|v| v.is_object() && !v.as_object().unwrap().is_empty())
            .unwrap_or(false);
        // An object with an explicit `additionalProperties: <schema>`
        // (object schema, not boolean) bounds the shape; allow that.
        let ap_is_bounded_schema = obj
            .get("additionalProperties")
            .map(|v| v.is_object())
            .unwrap_or(false);
        let has_one_of = obj.get("oneOf").map(|v| v.is_array()).unwrap_or(false);
        let has_any_of = obj.get("anyOf").map(|v| v.is_array()).unwrap_or(false);
        let has_all_of = obj.get("allOf").map(|v| v.is_array()).unwrap_or(false);

        if !has_properties
            && !has_pattern_properties
            && !ap_is_bounded_schema
            && !has_one_of
            && !has_any_of
            && !has_all_of
        {
            return Err(PermissivePattern::ObjectWithoutProperties {
                json_pointer: if pointer.is_empty() {
                    "/".to_owned()
                } else {
                    pointer.to_owned()
                },
            });
        }
    }

    // (4) Recursively descend into composite keywords.
    if let Some(props) = obj.get("properties").and_then(|v| v.as_object()) {
        for (name, child) in props {
            walk(
                root,
                child,
                &format!("{}/properties/{}", pointer, escape_pointer(name)),
                visited,
            )?;
        }
    }

    if let Some(ap) = obj.get("additionalProperties")
        && ap.is_object()
    {
        walk(
            root,
            ap,
            &format!("{}/additionalProperties", pointer),
            visited,
        )?;
    }

    if let Some(items) = obj.get("items") {
        walk(root, items, &format!("{}/items", pointer), visited)?;
    }

    for combinator in &["oneOf", "anyOf", "allOf"] {
        if let Some(arr) = obj.get(*combinator).and_then(|v| v.as_array()) {
            for (i, branch) in arr.iter().enumerate() {
                walk(
                    root,
                    branch,
                    &format!("{}/{}/{}", pointer, combinator, i),
                    visited,
                )?;
            }
        }
    }

    Ok(())
}

fn escape_pointer(s: &str) -> String {
    s.replace('~', "~0").replace('/', "~1")
}

/// Resolve a local JSON Pointer (`$defs/foo`, `definitions/foo`) against
/// the root schema. Returns the referenced value or `None`.
fn resolve_local_ref<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = root;
    for segment in path.split('/') {
        let unescaped = segment.replace("~1", "/").replace("~0", "~");
        match cur {
            Value::Object(map) => {
                cur = map.get(&unescaped)?;
            }
            Value::Array(arr) => {
                let idx: usize = unescaped.parse().ok()?;
                cur = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(cur)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strict_schema_with_properties_passes() {
        let schema = json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" }
            },
            "required": ["name"]
        });
        assert!(validate_strict_schema(&schema).is_ok());
    }

    #[test]
    fn additional_properties_true_rejected() {
        let schema = json!({
            "type": "object",
            "properties": { "name": { "type": "string" } },
            "additionalProperties": true
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::AdditionalPropertiesTrue { .. }) => (),
            other => panic!("expected AdditionalPropertiesTrue, got {other:?}"),
        }
    }

    #[test]
    fn type_any_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {
                "payload": { "type": "any" }
            }
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::TypeAny { .. }) => (),
            other => panic!("expected TypeAny, got {other:?}"),
        }
    }

    #[test]
    fn object_without_properties_rejected() {
        let schema = json!({ "type": "object" });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::ObjectWithoutProperties { .. }) => (),
            other => panic!("expected ObjectWithoutProperties, got {other:?}"),
        }
    }

    #[test]
    fn empty_properties_object_still_rejected() {
        let schema = json!({ "type": "object", "properties": {} });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::ObjectWithoutProperties { .. }) => (),
            other => panic!("expected ObjectWithoutProperties, got {other:?}"),
        }
    }

    #[test]
    fn additional_properties_false_with_properties_passes() {
        let schema = json!({
            "type": "object",
            "properties": { "name": { "type": "string" } },
            "additionalProperties": false
        });
        assert!(validate_strict_schema(&schema).is_ok());
    }

    #[test]
    fn additional_properties_as_bounded_schema_passes() {
        // additionalProperties: <object-schema> bounds the shape, satisfies
        // the strictness requirement even without explicit `properties`.
        let schema = json!({
            "type": "object",
            "additionalProperties": { "type": "string" }
        });
        assert!(validate_strict_schema(&schema).is_ok());
    }

    #[test]
    fn nested_property_permissiveness_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {
                "nested": {
                    "type": "object",
                    "additionalProperties": true
                }
            }
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::AdditionalPropertiesTrue { json_pointer }) => {
                assert!(json_pointer.contains("/properties/nested"));
            }
            other => panic!("expected nested AdditionalPropertiesTrue, got {other:?}"),
        }
    }

    #[test]
    fn one_of_with_permissive_branch_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {
                "value": {
                    "oneOf": [
                        { "type": "string" },
                        { "type": "any" }
                    ]
                }
            }
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::TypeAny { json_pointer }) => {
                assert!(json_pointer.contains("/oneOf/1"));
            }
            other => panic!("expected TypeAny inside oneOf, got {other:?}"),
        }
    }

    #[test]
    fn any_of_with_permissive_branch_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {
                "value": {
                    "anyOf": [
                        { "type": "string" },
                        { "type": "object" }
                    ]
                }
            }
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::ObjectWithoutProperties { json_pointer }) => {
                assert!(json_pointer.contains("/anyOf/1"));
            }
            other => panic!("expected ObjectWithoutProperties inside anyOf, got {other:?}"),
        }
    }

    #[test]
    fn ref_to_strict_schema_passes() {
        let schema = json!({
            "type": "object",
            "properties": {
                "ref_to_strict": { "$ref": "#/$defs/strict" }
            },
            "$defs": {
                "strict": {
                    "type": "object",
                    "properties": { "x": { "type": "string" } }
                }
            }
        });
        assert!(validate_strict_schema(&schema).is_ok());
    }

    #[test]
    fn ref_to_permissive_schema_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {
                "ref_to_loose": { "$ref": "#/$defs/loose" }
            },
            "$defs": {
                "loose": { "type": "object", "additionalProperties": true }
            }
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::AdditionalPropertiesTrue { .. }) => (),
            other => panic!("expected AdditionalPropertiesTrue via $ref, got {other:?}"),
        }
    }

    #[test]
    fn unresolvable_external_ref_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {
                "external": { "$ref": "https://example.com/schema.json" }
            }
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::UnresolvableRef { target, .. }) => {
                assert_eq!(target, "https://example.com/schema.json");
            }
            other => panic!("expected UnresolvableRef, got {other:?}"),
        }
    }

    #[test]
    fn unresolvable_local_ref_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {
                "missing": { "$ref": "#/$defs/does_not_exist" }
            }
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::UnresolvableRef { .. }) => (),
            other => panic!("expected UnresolvableRef, got {other:?}"),
        }
    }

    #[test]
    fn cyclic_ref_does_not_infinite_loop() {
        let schema = json!({
            "type": "object",
            "properties": {
                "self": { "$ref": "#/$defs/node" }
            },
            "$defs": {
                "node": {
                    "type": "object",
                    "properties": {
                        "child": { "$ref": "#/$defs/node" }
                    }
                }
            }
        });
        assert!(validate_strict_schema(&schema).is_ok());
    }

    #[test]
    fn items_with_permissive_array_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {
                "list": {
                    "type": "array",
                    "items": { "type": "object" }
                }
            }
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::ObjectWithoutProperties { json_pointer }) => {
                assert!(json_pointer.contains("/items"));
            }
            other => panic!("expected ObjectWithoutProperties under items, got {other:?}"),
        }
    }

    #[test]
    fn type_array_with_any_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {
                "value": { "type": ["string", "any"] }
            }
        });
        match validate_strict_schema(&schema) {
            Err(PermissivePattern::TypeAny { .. }) => (),
            other => panic!("expected TypeAny in type array, got {other:?}"),
        }
    }
}

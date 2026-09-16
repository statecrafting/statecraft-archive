// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-016, FR-017

// Pure-function tests for the external extraction-output endpoint
// helpers. The DB-touching paths (idempotency duplicate, resolver
// ordering) are exercised by Phase 6's end-to-end tests under the Encore
// test runner; vitest here covers what can be tested without a database.

import { describe, expect, test } from "vitest";
import {
  KNOWLEDGE_SCHEMA_VERSION,
  MINIMUM_KNOWLEDGE_SCHEMA_VERSION,
  KNOWLEDGE_SCHEMA_VERSION_HEADER,
} from "./extractionOutput";

describe("KNOWLEDGE_SCHEMA_VERSION constants", () => {
  test("KNOWLEDGE_SCHEMA_VERSION matches MINIMUM_KNOWLEDGE_SCHEMA_VERSION at V1", () => {
    expect(KNOWLEDGE_SCHEMA_VERSION).toBe(MINIMUM_KNOWLEDGE_SCHEMA_VERSION);
  });

  test("schema-version header name is lowercase per Encore convention", () => {
    expect(KNOWLEDGE_SCHEMA_VERSION_HEADER).toBe("x-knowledge-schema-version");
  });
});

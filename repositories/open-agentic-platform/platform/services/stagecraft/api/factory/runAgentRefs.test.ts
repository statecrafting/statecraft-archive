// Spec 124 §4.1 / T022 — pure-function tests for the agent-reference walker.
//
// These run under bare `npm test` (no DB). The DB-bound resolver path
// (`resolveProcessAgentRefs`) needs Postgres + agent_catalog rows and is
// covered by the integration test in `runs.test.ts` (encore-test only).

import { describe, expect, it } from "vitest";
import {
  walkForAgentRefs,
  type AgentRefVariant,
} from "./agentRefWalker";

describe("walkForAgentRefs — externally-tagged AgentReference shapes", () => {
  it("matches the ById variant", () => {
    const refs = walkForAgentRefs({
      by_id: { org_agent_id: "a-1", version: 3 },
    });
    expect(refs).toEqual([
      { by_id: { org_agent_id: "a-1", version: 3 } },
    ]);
  });

  it("matches the ByName variant", () => {
    const refs = walkForAgentRefs({
      by_name: { name: "stage-cd-comparator", version: 2 },
    });
    expect(refs).toEqual([
      { by_name: { name: "stage-cd-comparator", version: 2 } },
    ]);
  });

  it("matches the ByNameLatest variant", () => {
    const refs = walkForAgentRefs({
      by_name_latest: { name: "stage-cd-comparator" },
    });
    expect(refs).toEqual([
      { by_name_latest: { name: "stage-cd-comparator" } },
    ]);
  });

  it("walks into nested structures", () => {
    const definition = {
      stages: [
        { id: "s0", agent_ref: { by_name_latest: { name: "extract" } } },
        {
          id: "s1",
          agent_ref: { by_name: { name: "design", version: 4 } },
        },
        { id: "s2", agent_ref: { by_id: { org_agent_id: "a-9", version: 1 } } },
      ],
      meta: {
        comparator: { by_name_latest: { name: "compare" } },
      },
    };
    const refs = walkForAgentRefs(definition);
    expect(refs).toHaveLength(4);
    // Stage-occurrence order is preserved by the depth-first walk; the
    // meta.comparator entry comes after the stages because object key
    // iteration follows insertion order in V8.
    expect(refs[0]).toEqual({ by_name_latest: { name: "extract" } });
    expect(refs[1]).toEqual({ by_name: { name: "design", version: 4 } });
    expect(refs[2]).toEqual({ by_id: { org_agent_id: "a-9", version: 1 } });
    expect(refs[3]).toEqual({ by_name_latest: { name: "compare" } });
  });

  it("ignores non-matching shapes", () => {
    const refs = walkForAgentRefs({
      // Has the right tag name but wrong inner shape — must not match.
      by_id: { foo: "bar" },
      by_name: { name: 123 },
      // Sibling keys at the same level as a tag — the walker only matches
      // single-key envelopes, so this multi-key node is not a ref.
      mixed: {
        by_name_latest: { name: "x" },
        sibling: "noise",
      },
    });
    // Nothing matches: the top-level object has 3 keys (rejects), each
    // recursed value either fails the inner shape check (`by_id`, `by_name`)
    // or is itself multi-key (`mixed`).
    expect(refs).toEqual([]);
  });

  it("matches a single-key envelope even when nested deep", () => {
    // The realistic statecraft case — a process definition has an
    // `agent_ref` field whose value is a single-key envelope. The walker
    // matches it exactly.
    const refs = walkForAgentRefs({
      stages: [
        { id: "s0", agent_ref: { by_name_latest: { name: "extract" } } },
      ],
    });
    expect(refs).toEqual([{ by_name_latest: { name: "extract" } }]);
  });

  it("does not recurse into a matched variant — agent inputs are leaves", () => {
    // If a `by_id` carries a payload that itself looks like an
    // AgentReference (it shouldn't in real life, but let's be defensive),
    // we must not double-count.
    const refs = walkForAgentRefs({
      by_id: {
        org_agent_id: "a-1",
        version: 2,
      },
    });
    expect(refs).toHaveLength(1);
  });

  it("handles arrays of stages without duplication", () => {
    const refs = walkForAgentRefs([
      { by_name_latest: { name: "a" } },
      { by_name_latest: { name: "b" } },
      { by_name_latest: { name: "c" } },
    ]);
    expect(refs.map((r) => (r as { by_name_latest: { name: string } }).by_name_latest.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("handles primitives and null without throwing", () => {
    expect(walkForAgentRefs(null)).toEqual([]);
    expect(walkForAgentRefs(undefined)).toEqual([]);
    expect(walkForAgentRefs(42)).toEqual([]);
    expect(walkForAgentRefs("agent")).toEqual([]);
    expect(walkForAgentRefs(true)).toEqual([]);
  });

  it("returns an empty array for empty objects", () => {
    expect(walkForAgentRefs({})).toEqual([]);
    expect(walkForAgentRefs([])).toEqual([]);
  });

  it("stage-order is preserved across mixed variants", () => {
    const definition = {
      stages: [
        { agent_ref: { by_id: { org_agent_id: "first", version: 1 } } },
        { agent_ref: { by_name: { name: "second", version: 2 } } },
        { agent_ref: { by_name_latest: { name: "third" } } },
      ],
    };
    const refs = walkForAgentRefs(definition);
    const tags: string[] = refs.map((r: AgentRefVariant) => Object.keys(r)[0]);
    expect(tags).toEqual(["by_id", "by_name", "by_name_latest"]);
  });
});

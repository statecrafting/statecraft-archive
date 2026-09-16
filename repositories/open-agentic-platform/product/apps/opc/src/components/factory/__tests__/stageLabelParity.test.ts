// Spec: specs/076-factory-desktop-panel/spec.md
// Parity lock with the Rust `stage_display_name` in
// product/apps/opc/src-tauri/src/commands/factory.rs
// (test `stage_display_name_matches_ts_titleize_parity`). The SAME
// (input, expected) vector is asserted on both sides so the two stage-label
// implementations — Rust's hand-rolled prefix strip and TS's `/^s\d+-/`
// regex — cannot silently diverge.

import { describe, it, expect } from 'vitest';
import { stagesFromProcessDefinition } from '../types';

describe('stage label parity with Rust stage_display_name', () => {
  // A leading `sN-` prefix is stripped ONLY when every char after `s` is a
  // digit. So `ss-something` and `s1a-foo` are NOT stripped, and `s` alone is
  // never a prefix. (`ss-something` is the case the AI review claimed
  // diverged; both languages keep it intact and titleise identically.)
  const cases: [string, string][] = [
    ['s0-preflight', 'Pre-flight'],         // curated canonical label
    ['s6-scaffolding', 'Scaffolding'],      // sN- stripped (all-digit)
    ['s10-deep-dive', 'Deep Dive'],         // multi-digit prefix stripped
    ['s6a-entity-user', 'S6a Entity User'], // "6a" not all-digit → kept
    ['ss-something', 'Ss Something'],       // not stripped (disputed case)
    ['s1a-foo', 'S1a Foo'],                 // "1a" not all-digit → kept
    ['s-foo', 'S Foo'],                     // "s" alone is not an sN- prefix
    ['adapter-handoff', 'Adapter Handoff'], // no prefix
  ];

  it.each(cases)('labels %s as %s', (id, expected) => {
    const stages = stagesFromProcessDefinition({ stages: [{ id }] });
    expect(stages).toEqual([{ id, name: expected }]);
  });
});

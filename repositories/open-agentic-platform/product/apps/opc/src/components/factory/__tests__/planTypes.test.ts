// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// Tests the deterministic hash (FR-008, SC-005) and the approval-state
// helpers (FR-005).

import { describe, it, expect } from 'vitest';
import {
  type AgentPlan,
  canonicalPlanJson,
  hashPlan,
  createInitialApprovalState,
  isPlanFullyAcknowledged,
} from '../planTypes';

function basePlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    id: 'plan-001',
    proposedAt: '2026-05-23T10:00:00Z',
    proposedBy: 'agent:claude',
    actions: [
      {
        id: 'a1',
        kind: 'edit_spec',
        target: 'specs/137-tenant-environment-access-gates/spec.md',
        diff: { hunks: ['@@ -1,1 +1,1 @@\n-status: draft\n+status: approved'] },
      },
      {
        id: 'a2',
        kind: 'edit_code',
        target: 'platform/services/statecraft/api/auth/rauthyAdminClients.ts',
        diff: { hunks: ['@@ -1,1 +1,1 @@\n- old\n+ new'] },
      },
    ],
    structuralDiff: {
      added: [],
      removed: [],
      modified: [
        {
          spec: {
            id: '137-tenant-environment-access-gates',
            slug: 'tenant-environment-access-gates',
            path: 'specs/137-tenant-environment-access-gates/spec.md',
          },
          changes: [{ field: 'status', before: 'draft', after: 'approved' }],
        },
      ],
    },
    ...overrides,
  };
}

describe('canonicalPlanJson', () => {
  it('produces identical output regardless of key insertion order', () => {
    const a = basePlan();
    // Reconstruct with reversed key order — would diverge under naive
    // JSON.stringify, but canonicalize sorts keys recursively.
    const b: AgentPlan = {
      structuralDiff: a.structuralDiff,
      actions: a.actions,
      proposedBy: a.proposedBy,
      proposedAt: a.proposedAt,
      id: a.id,
    };
    expect(canonicalPlanJson(a)).toBe(canonicalPlanJson(b));
  });

  it('preserves action order — actions are an ordered sequence', () => {
    const a = basePlan();
    const reversed = basePlan({ actions: [...a.actions].reverse() });
    expect(canonicalPlanJson(a)).not.toBe(canonicalPlanJson(reversed));
  });

  it('ignores the narrative field — prose is the demoted surface', () => {
    const a = basePlan({ narrative: 'I will gently amend the spec.' });
    const b = basePlan({ narrative: 'Completely different prose.' });
    expect(canonicalPlanJson(a)).toBe(canonicalPlanJson(b));
  });
});

describe('hashPlan', () => {
  it('returns a 16-char hex string', () => {
    const h = hashPlan(basePlan());
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('same plan → same hash (SC-005)', () => {
    const a = hashPlan(basePlan());
    const b = hashPlan(basePlan());
    expect(a).toBe(b);
  });

  it('changed action target → different hash', () => {
    const a = hashPlan(basePlan());
    const mutated = basePlan();
    mutated.actions[0].target = 'specs/other/spec.md';
    const b = hashPlan(mutated);
    expect(a).not.toBe(b);
  });

  it('changed narrative only → same hash (FR-008)', () => {
    const a = hashPlan(basePlan({ narrative: 'one' }));
    const b = hashPlan(basePlan({ narrative: 'two' }));
    expect(a).toBe(b);
  });
});

describe('approval traversal helpers', () => {
  it('initial approval state is fully un-acknowledged', () => {
    const plan = basePlan();
    const state = createInitialApprovalState(plan);
    expect(state.planId).toBe(plan.id);
    expect(state.acknowledgements).toEqual({ a1: false, a2: false });
    expect(isPlanFullyAcknowledged(plan, state)).toBe(false);
  });

  it('requires every action acknowledged before approval enables', () => {
    const plan = basePlan();
    const state = createInitialApprovalState(plan);
    state.acknowledgements.a1 = true;
    expect(isPlanFullyAcknowledged(plan, state)).toBe(false);
    state.acknowledgements.a2 = true;
    expect(isPlanFullyAcknowledged(plan, state)).toBe(true);
  });

  it('rejects an approval state bound to a different plan id', () => {
    const plan = basePlan();
    const state = createInitialApprovalState(plan);
    state.acknowledgements.a1 = true;
    state.acknowledgements.a2 = true;
    expect(isPlanFullyAcknowledged({ ...plan, id: 'other' }, state)).toBe(
      false,
    );
  });

  it('an empty action list is not approvable — nothing to acknowledge', () => {
    const plan = basePlan({ actions: [] });
    const state = createInitialApprovalState(plan);
    expect(isPlanFullyAcknowledged(plan, state)).toBe(false);
  });
});

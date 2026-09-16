// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// Pin the gate-impact / critical-action inference + summary helpers.

import { describe, it, expect } from 'vitest';
import {
  enrichPlan,
  inferCriticalMarker,
  inferGateImpact,
  isInvariantPath,
  isKernelPath,
  isProductionDeployTarget,
  summarizeGateImpact,
} from '../planAnalysis';
import type { AgentPlan, PlanAction } from '../planTypes';

function specEdit(target: string, id = 'a-spec'): PlanAction {
  return { id, kind: 'edit_spec', target };
}
function codeEdit(target: string, id = 'a-code'): PlanAction {
  return { id, kind: 'edit_code', target };
}
function deployAction(target: string, id = 'a-deploy'): PlanAction {
  return { id, kind: 'deploy', target };
}

function planFrom(actions: PlanAction[]): AgentPlan {
  return {
    id: 'p',
    proposedAt: '2026-05-23T10:00:00Z',
    proposedBy: 'agent:test',
    actions,
    structuralDiff: { added: [], removed: [], modified: [] },
  };
}

describe('path classifiers', () => {
  it('detects spec 167 kernel paths', () => {
    expect(isKernelPath('crates/factory-engine/src/engine.rs')).toBe(true);
    expect(isKernelPath('crates/factory-engine/src/lib.rs')).toBe(true);
    expect(
      isKernelPath('crates/factory-engine/src/inter_stage_manifest.rs'),
    ).toBe(true);
    expect(isKernelPath('crates/factory-engine/src/cli.rs')).toBe(false);
  });

  it('detects spec 132 invariant-freeze paths', () => {
    expect(isInvariantPath('standards/spec/constitution.md')).toBe(true);
    expect(isInvariantPath('standards/spec/contract.md')).toBe(true);
    expect(isInvariantPath('specs/000-bootstrap-spec-system/spec.md')).toBe(
      true,
    );
    expect(isInvariantPath('specs/171-opc-structural-diff-plan-ui/spec.md')).toBe(
      false,
    );
  });

  it('detects production deploy targets', () => {
    expect(isProductionDeployTarget('prod')).toBe(true);
    expect(isProductionDeployTarget('production')).toBe(true);
    expect(isProductionDeployTarget('prod-eu-1')).toBe(true);
    expect(isProductionDeployTarget('hetzner-prod')).toBe(true);
    expect(isProductionDeployTarget('dev')).toBe(false);
    expect(isProductionDeployTarget('staging')).toBe(false);
  });
});

describe('inferCriticalMarker (FR-007)', () => {
  it('marks kernel-path edits as kernel-critical', () => {
    const m = inferCriticalMarker(
      codeEdit('crates/factory-engine/src/engine.rs'),
    );
    expect(m?.category).toBe('kernel');
    expect(m?.requiredAcks).toBe(2);
  });

  it('marks invariant-freeze path edits as invariant-critical', () => {
    const m = inferCriticalMarker(specEdit('standards/spec/constitution.md'));
    expect(m?.category).toBe('invariant');
  });

  it('marks production deploys as production-deploy critical', () => {
    const m = inferCriticalMarker(deployAction('hetzner-prod'));
    expect(m?.category).toBe('production-deploy');
  });

  it('returns null for routine actions', () => {
    expect(inferCriticalMarker(codeEdit('src/foo.ts'))).toBeNull();
    expect(inferCriticalMarker(deployAction('dev'))).toBeNull();
  });
});

describe('inferGateImpact (FR-003)', () => {
  it('warns spec-code-coupling on a lone spec edit', () => {
    const action = specEdit('specs/137-tenant-environment-access-gates/spec.md');
    const plan = planFrom([action]);
    const impact = inferGateImpact(action, plan);
    const coupling = impact.entries.find((e) => e.gate === 'spec-code-coupling');
    expect(coupling?.level).toBe('warn');
  });

  it('passes spec-code-coupling when plan also edits matching code', () => {
    const a1 = specEdit(
      'specs/137-tenant-environment-access-gates/spec.md',
      'a1',
    );
    const a2 = codeEdit(
      'platform/services/statecraft/api/auth/137-tenant-environment-access-gates.ts',
      'a2',
    );
    const plan = planFrom([a1, a2]);
    const impact = inferGateImpact(a1, plan);
    const coupling = impact.entries.find((e) => e.gate === 'spec-code-coupling');
    expect(coupling?.level).toBe('pass');
  });

  it('fails invariant-freeze on invariant-path spec edit', () => {
    const action = specEdit('standards/spec/constitution.md');
    const plan = planFrom([action]);
    const impact = inferGateImpact(action, plan);
    expect(
      impact.entries.find((e) => e.gate === 'invariant-freeze')?.level,
    ).toBe('fail');
  });

  it('warns on kernel-path code edits', () => {
    const action = codeEdit('crates/factory-engine/src/engine.rs');
    const plan = planFrom([action, specEdit('specs/some/spec.md', 'b')]);
    const impact = inferGateImpact(action, plan);
    expect(
      impact.entries.find((e) => e.gate === 'invariant-freeze')?.level,
    ).toBe('warn');
  });
});

describe('enrichPlan', () => {
  it('preserves action order (canonical-hash safe)', () => {
    const plan = planFrom([
      specEdit('specs/aaa/spec.md', 'a1'),
      codeEdit('src/bbb.ts', 'a2'),
    ]);
    const enriched = enrichPlan(plan);
    expect(enriched.actions.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('fills gateImpact and critical on routine actions when omitted', () => {
    const plan = planFrom([codeEdit('crates/factory-engine/src/engine.rs')]);
    const enriched = enrichPlan(plan);
    expect(enriched.actions[0].critical?.category).toBe('kernel');
    expect(enriched.actions[0].gateImpact?.entries.length).toBeGreaterThan(0);
  });

  it('respects pre-filled gateImpact / critical (idempotent)', () => {
    const plan = planFrom([
      {
        ...codeEdit('crates/factory-engine/src/engine.rs'),
        gateImpact: { entries: [] },
        critical: {
          category: 'kernel',
          reason: 'preset',
          requiredAcks: 3,
        },
      },
    ]);
    const enriched = enrichPlan(plan);
    expect(enriched.actions[0].gateImpact?.entries).toEqual([]);
    expect(enriched.actions[0].critical?.requiredAcks).toBe(3);
  });
});

describe('summarizeGateImpact', () => {
  it('rolls up worst level + per-level counts + criticals', () => {
    const a1 = {
      ...specEdit('specs/132-constitutional-invariant-freeze/spec.md', 'a1'),
      gateImpact: {
        entries: [
          { gate: 'invariant-freeze', level: 'fail', reason: 'r' },
        ] as any,
      },
      critical: {
        category: 'invariant' as const,
        reason: 'r',
        requiredAcks: 2,
      },
    };
    const a2 = {
      ...codeEdit('src/x.ts', 'a2'),
      gateImpact: {
        entries: [
          { gate: 'spec-code-coupling', level: 'warn', reason: 'r' },
        ] as any,
      },
    };
    const a3 = {
      ...codeEdit('src/y.ts', 'a3'),
      gateImpact: { entries: [] },
    };
    const plan = planFrom([a1, a2, a3]);
    const s = summarizeGateImpact(plan);
    expect(s.total).toBe(3);
    expect(s.failCount).toBe(1);
    expect(s.warnCount).toBe(1);
    expect(s.criticalCount).toBe(1);
    expect(s.worst).toBe('fail');
  });

  it('returns pass / zeros for an unflagged plan', () => {
    const plan = planFrom([codeEdit('src/foo.ts', 'a1')]);
    const s = summarizeGateImpact(plan);
    expect(s.worst).toBe('pass');
    expect(s.failCount).toBe(0);
    expect(s.warnCount).toBe(0);
    expect(s.criticalCount).toBe(0);
  });
});

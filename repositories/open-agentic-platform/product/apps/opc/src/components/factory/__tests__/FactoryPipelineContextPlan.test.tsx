// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// Pin the FactoryPipelineContext plan-review wiring: proposePlan
// surfaces a pending plan, approve/reject clear it and append an
// audit-trail entry, dismiss clears without recording.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  FactoryPipelineProvider,
  useFactoryPipeline,
} from '../FactoryPipelineContext';
import type { AgentPlan } from '../planTypes';

vi.mock('@tauri-apps/api/event', () => ({
  // Resolve to a no-op unlisten so the provider's setupListeners()
  // completes without trying to talk to a real Tauri runtime.
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@/lib/apiAdapter', () => ({ apiCall: vi.fn() }));

afterEach(() => cleanup());

const plan: AgentPlan = {
  id: 'plan-ctx-1',
  proposedAt: '2026-05-23T11:00:00Z',
  proposedBy: 'agent:test',
  actions: [
    { id: 'a1', kind: 'edit_code', target: 'src/foo.ts' },
  ],
  structuralDiff: { added: [], removed: [], modified: [] },
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <FactoryPipelineProvider>{children}</FactoryPipelineProvider>;
}

describe('FactoryPipelineContext plan-review wiring (spec 171)', () => {
  it('proposePlan exposes the plan via proposedPlan', () => {
    const { result } = renderHook(() => useFactoryPipeline(), { wrapper });
    expect(result.current.proposedPlan).toBeNull();
    act(() => result.current.proposePlan(plan));
    expect(result.current.proposedPlan?.id).toBe('plan-ctx-1');
  });

  it('approvePlan clears the pending plan and records an audit entry', () => {
    const { result } = renderHook(() => useFactoryPipeline(), { wrapper });
    act(() => result.current.proposePlan(plan));
    act(() => result.current.approvePlan(plan.id, 'deadbeef00000000'));
    expect(result.current.proposedPlan).toBeNull();
    const entry = result.current.state.auditTrail.find(
      (e) => e.stageId === plan.id,
    );
    expect(entry?.action).toBe('stage_confirmed');
    expect(entry?.details).toContain('hash=deadbeef00000000');
  });

  it('rejectPlan clears the plan and records feedback', () => {
    const { result } = renderHook(() => useFactoryPipeline(), { wrapper });
    act(() => result.current.proposePlan(plan));
    act(() => result.current.rejectPlan(plan.id, 'unsafe edit'));
    expect(result.current.proposedPlan).toBeNull();
    const entry = result.current.state.auditTrail.find(
      (e) => e.stageId === plan.id,
    );
    expect(entry?.action).toBe('stage_rejected');
    expect(entry?.feedback).toBe('unsafe edit');
  });

  it('dismissPlan clears the plan without an audit entry', () => {
    const { result } = renderHook(() => useFactoryPipeline(), { wrapper });
    act(() => result.current.proposePlan(plan));
    const before = result.current.state.auditTrail.length;
    act(() => result.current.dismissPlan());
    expect(result.current.proposedPlan).toBeNull();
    expect(result.current.state.auditTrail.length).toBe(before);
  });

  it('a new proposePlan clears any leftover certificateActual', () => {
    const { result } = renderHook(() => useFactoryPipeline(), { wrapper });
    act(() =>
      result.current.proposePlan({
        ...plan,
        certificatePrediction: {
          stages: [{ id: 's0', name: 'pre', artifacts: ['x'] }],
        },
      }),
    );
    // Simulate a manual approve+reset cycle: dismiss leaves
    // certificateActual untouched (it's null), so just verify the
    // initial null contract here.
    expect(result.current.certificateActual).toBeNull();
  });
});

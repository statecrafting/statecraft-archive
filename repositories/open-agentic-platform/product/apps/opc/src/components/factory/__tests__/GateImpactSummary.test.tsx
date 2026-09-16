// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// FR-003 — rolled-up gate-impact preview tests.
// Pin the rolled-up gate-impact preview rendering.

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GateImpactSummary } from '../GateImpactSummary';
import type { AgentPlan } from '../planTypes';

afterEach(() => cleanup());

function planWith(actions: AgentPlan['actions']): AgentPlan {
  return {
    id: 'p',
    proposedAt: '2026-05-23T10:00:00Z',
    proposedBy: 'agent:test',
    actions,
    structuralDiff: { added: [], removed: [], modified: [] },
  };
}

describe('GateImpactSummary', () => {
  it('renders worst=pass on a plan with no impact entries', () => {
    const plan = planWith([
      { id: 'a1', kind: 'edit_code', target: 'src/foo.ts' },
    ]);
    render(<GateImpactSummary plan={plan} />);
    const node = screen.getByTestId('gate-impact-summary');
    expect(node.getAttribute('data-worst')).toBe('pass');
    expect(screen.getByText(/Predicted to pass all gates/)).toBeInTheDocument();
  });

  it('renders worst=warn and the warn count for warning plans', () => {
    const plan = planWith([
      {
        id: 'a1',
        kind: 'edit_spec',
        target: 'specs/x/spec.md',
        gateImpact: {
          entries: [
            { gate: 'spec-code-coupling', level: 'warn', reason: 'r' },
          ],
        },
      },
    ]);
    render(<GateImpactSummary plan={plan} />);
    const node = screen.getByTestId('gate-impact-summary');
    expect(node.getAttribute('data-worst')).toBe('warn');
    expect(screen.getByText(/warn against a gate/)).toBeInTheDocument();
    expect(screen.getByTestId('gate-impact-warn-count').textContent).toContain(
      '1',
    );
  });

  it('renders worst=fail and surfaces M-of-N critical count when present', () => {
    const plan = planWith([
      {
        id: 'a1',
        kind: 'edit_spec',
        target: 'standards/spec/constitution.md',
        gateImpact: {
          entries: [
            { gate: 'invariant-freeze', level: 'fail', reason: 'r' },
          ],
        },
        critical: {
          category: 'invariant',
          reason: 'r',
          requiredAcks: 2,
        },
      },
    ]);
    render(<GateImpactSummary plan={plan} />);
    const node = screen.getByTestId('gate-impact-summary');
    expect(node.getAttribute('data-worst')).toBe('fail');
    expect(screen.getByTestId('gate-impact-fail-count').textContent).toContain(
      '1',
    );
    expect(
      screen.getByTestId('gate-impact-critical-count'),
    ).toBeInTheDocument();
  });
});

// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// Pin the render invariants for PlanStructuralDiff + PlanActionGraph.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PlanStructuralDiff } from '../PlanStructuralDiff';
import { PlanActionGraph } from '../PlanActionGraph';
import type { AgentPlan, StructuralDiff } from '../planTypes';

afterEach(() => cleanup());

const baseDiff: StructuralDiff = {
  added: [
    {
      id: '199-new-spec',
      slug: 'new-spec',
      path: 'specs/199-new-spec/spec.md',
    },
  ],
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
};

const basePlan: AgentPlan = {
  id: 'plan-001',
  proposedAt: '2026-05-23T10:00:00Z',
  proposedBy: 'agent:claude',
  actions: [
    {
      id: 'a1',
      kind: 'edit_spec',
      target: 'specs/137-tenant-environment-access-gates/spec.md',
      diff: {
        frontmatter: [{ field: 'status', before: 'draft', after: 'approved' }],
      },
      gateImpact: {
        entries: [
          {
            gate: 'spec-code-coupling',
            level: 'warn',
            reason: 'Spec edit without matching code change.',
          },
        ],
      },
    },
    {
      id: 'a2',
      kind: 'edit_code',
      target: 'platform/services/statecraft/api/auth/rauthyAdminClients.ts',
      diff: { hunks: ['@@ -1 +1 @@\n- old\n+ new'] },
      critical: {
        category: 'invariant',
        reason: 'Touches spec 132 invariant freeze.',
        requiredAcks: 2,
      },
    },
  ],
  structuralDiff: baseDiff,
};

describe('PlanStructuralDiff', () => {
  it('renders added / removed / modified counts in the header', () => {
    render(<PlanStructuralDiff diff={baseDiff} />);
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-0')).toBeInTheDocument();
    expect(screen.getByText('~1')).toBeInTheDocument();
  });

  it('renders an added spec row with its id and path', () => {
    render(<PlanStructuralDiff diff={baseDiff} />);
    const added = screen.getByTestId('structural-diff-row-added');
    expect(within(added).getByText('199-new-spec')).toBeInTheDocument();
    expect(
      within(added).getByText('specs/199-new-spec/spec.md'),
    ).toBeInTheDocument();
  });

  it('renders a modified spec with its frontmatter changes', () => {
    render(<PlanStructuralDiff diff={baseDiff} />);
    const modified = screen.getByTestId('structural-diff-row-modified');
    expect(
      within(modified).getByText('137-tenant-environment-access-gates'),
    ).toBeInTheDocument();
    expect(within(modified).getByText('status:')).toBeInTheDocument();
    expect(within(modified).getByText('draft')).toBeInTheDocument();
    expect(within(modified).getByText('approved')).toBeInTheDocument();
  });

  it('renders an explicit empty state when the diff is empty', () => {
    render(
      <PlanStructuralDiff
        diff={{ added: [], removed: [], modified: [] }}
      />,
    );
    expect(screen.getByTestId('structural-diff-empty')).toBeInTheDocument();
  });
});

describe('PlanActionGraph', () => {
  it('renders one row per action with its kind and target', () => {
    render(
      <PlanActionGraph
        plan={basePlan}
        acknowledgements={{ a1: false, a2: false }}
        onToggleAcknowledged={() => {}}
      />,
    );
    expect(screen.getByTestId('plan-action-row-a1')).toBeInTheDocument();
    expect(screen.getByTestId('plan-action-row-a2')).toBeInTheDocument();
    expect(screen.getByText('edit spec')).toBeInTheDocument();
    expect(screen.getByText('edit code')).toBeInTheDocument();
  });

  it('renders the gate-impact badge with the predicted level', () => {
    render(
      <PlanActionGraph
        plan={basePlan}
        acknowledgements={{}}
        onToggleAcknowledged={() => {}}
      />,
    );
    expect(
      screen.getByTestId('gate-impact-spec-code-coupling-warn'),
    ).toBeInTheDocument();
  });

  it('renders the critical M-of-N marker on flagged actions (FR-007)', () => {
    render(
      <PlanActionGraph
        plan={basePlan}
        acknowledgements={{}}
        onToggleAcknowledged={() => {}}
      />,
    );
    expect(screen.getByTestId('critical-marker-a2')).toBeInTheDocument();
    expect(screen.getByText(/M-of-N/)).toBeInTheDocument();
  });

  it('toggles acknowledgement via the per-row checkbox (FR-005)', () => {
    const onToggle = vi.fn();
    render(
      <PlanActionGraph
        plan={basePlan}
        acknowledgements={{ a1: false, a2: false }}
        onToggleAcknowledged={onToggle}
      />,
    );
    fireEvent.click(screen.getByTestId('acknowledge-a1'));
    expect(onToggle).toHaveBeenCalledWith('a1');
  });

  it('renders the YAML view when showSerialised (default) and actions exist', () => {
    render(
      <PlanActionGraph
        plan={basePlan}
        acknowledgements={{}}
        onToggleAcknowledged={() => {}}
      />,
    );
    const yamlNode = screen.getByTestId('action-graph-yaml');
    expect(yamlNode).toBeInTheDocument();
    expect(yamlNode.textContent).toContain('plan_id: plan-001');
    expect(yamlNode.textContent).toContain('kind: edit_spec');
  });

  it('renders an empty state when no actions are present', () => {
    render(
      <PlanActionGraph
        plan={{ ...basePlan, actions: [] }}
        acknowledgements={{}}
        onToggleAcknowledged={() => {}}
      />,
    );
    expect(screen.getByTestId('action-graph-empty')).toBeInTheDocument();
  });
});

// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// Load-bearing UX invariants for the primary plan-review surface:
//   - structural diff is the first action surface (SC-001)
//   - approval gated on action-graph traversal (SC-002, FR-005)
//   - coupling-warning surfaces before approval (SC-003)
//   - certificate prediction renders + discrepancy gates approval (SC-004)
//   - narrative is a secondary, non-approval surface (FR-004)

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { PlanReviewDialog } from '../PlanReviewDialog';
import type {
  AgentPlan,
  CertificateActual,
  CertificatePrediction,
} from '../planTypes';

afterEach(() => cleanup());

function makePlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    id: 'plan-test',
    proposedAt: '2026-05-23T10:00:00Z',
    proposedBy: 'agent:test',
    actions: [
      {
        id: 'a1',
        kind: 'edit_spec',
        target: 'specs/137-tenant-environment-access-gates/spec.md',
        diff: {
          frontmatter: [{ field: 'status', before: 'draft', after: 'approved' }],
        },
      },
      {
        id: 'a2',
        kind: 'edit_code',
        target: 'platform/services/statecraft/api/auth/rauthyAdminClients.ts',
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
    narrative: 'I will tighten the tenant gates after the auth refactor.',
    ...overrides,
  };
}

const prediction: CertificatePrediction = {
  adapter: 'acme-vue-node',
  stages: [
    { id: 's0-preflight', name: 'Pre-flight', artifacts: ['preflight.json'] },
  ],
};

describe('PlanReviewDialog — structural diff is the primary surface', () => {
  it('renders the structural diff + action graph before the narrative pane', () => {
    render(
      <PlanReviewDialog
        plan={makePlan()}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    const diff = screen.getByTestId('plan-structural-diff');
    const graph = screen.getByTestId('plan-action-graph');
    const narrative = screen.getByTestId('plan-narrative-secondary');
    // DOM ordering reflects rendering priority.
    expect(diff.compareDocumentPosition(graph) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(graph.compareDocumentPosition(narrative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the gate-impact summary header (FR-003)', () => {
    render(
      <PlanReviewDialog
        plan={makePlan()}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('gate-impact-summary')).toBeInTheDocument();
  });

  it('renders deterministic plan id + hash', () => {
    render(
      <PlanReviewDialog
        plan={makePlan()}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('plan-id').textContent).toBe('plan-test');
    expect(screen.getByTestId('plan-hash').textContent).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('PlanReviewDialog — approval is gated on traversal (FR-005, SC-002)', () => {
  it('disables the approve button until every action is acknowledged', () => {
    const onApprove = vi.fn();
    render(
      <PlanReviewDialog
        plan={makePlan()}
        onApprove={onApprove}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    const approve = screen.getByTestId('plan-approve-button') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);

    // Acknowledge one of two actions — still disabled.
    fireEvent.click(screen.getByTestId('acknowledge-a1'));
    expect(approve.disabled).toBe(true);

    // Acknowledge the second — enables approve.
    fireEvent.click(screen.getByTestId('acknowledge-a2'));
    expect(approve.disabled).toBe(false);

    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledTimes(1);
    const [planId, planHash] = onApprove.mock.calls[0];
    expect(planId).toBe('plan-test');
    expect(planHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuses approval on plans with zero actions', () => {
    render(
      <PlanReviewDialog
        plan={makePlan({ actions: [] })}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    const approve = screen.getByTestId('plan-approve-button') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
  });

  it('shows running acknowledged count', () => {
    render(
      <PlanReviewDialog
        plan={makePlan()}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('plan-acked-count').textContent).toContain('0 / 2');
    fireEvent.click(screen.getByTestId('acknowledge-a1'));
    expect(screen.getByTestId('plan-acked-count').textContent).toContain('1 / 2');
  });
});

describe('PlanReviewDialog — coupling warning surfaces before approval (SC-003)', () => {
  it('surfaces a coupling warn marker on a lone spec edit', () => {
    const plan = makePlan({
      actions: [
        {
          id: 'a1',
          kind: 'edit_spec',
          target: 'specs/137-tenant-environment-access-gates/spec.md',
        },
      ],
    });
    render(
      <PlanReviewDialog
        plan={plan}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    // Coupling impact badge attached to the action by enrichPlan().
    expect(
      screen.getByTestId('gate-impact-spec-code-coupling-warn'),
    ).toBeInTheDocument();
  });
});

describe('PlanReviewDialog — certificate prediction (FR-006, SC-004)', () => {
  it('renders the prediction panel only when prediction is supplied', () => {
    const { rerender } = render(
      <PlanReviewDialog
        plan={makePlan()}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(
      screen.queryByTestId('plan-certificate-prediction'),
    ).not.toBeInTheDocument();

    rerender(
      <PlanReviewDialog
        plan={makePlan({ certificatePrediction: prediction })}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(
      screen.getByTestId('plan-certificate-prediction'),
    ).toBeInTheDocument();
  });

  it('gates approval when the actual certificate diverges from prediction', () => {
    const actual: CertificateActual = {
      stages: [{ id: 's0-preflight', name: 'Pre-flight', artifacts: ['other.json'] }],
    };
    render(
      <PlanReviewDialog
        plan={makePlan({ certificatePrediction: prediction })}
        certificateActual={actual}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    // Acknowledge all actions; approve should STILL be disabled because
    // of the certificate discrepancy gate.
    fireEvent.click(screen.getByTestId('acknowledge-a1'));
    fireEvent.click(screen.getByTestId('acknowledge-a2'));
    const approve = screen.getByTestId('plan-approve-button') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(
      screen.getByTestId('plan-cert-mismatch-warning'),
    ).toBeInTheDocument();
  });
});

describe('PlanReviewDialog — narrative is secondary (FR-004)', () => {
  it('narrative pane is collapsed by default and labelled non-approval', () => {
    render(
      <PlanReviewDialog
        plan={makePlan()}
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    const pane = screen.getByTestId('plan-narrative-secondary');
    expect(
      within(pane).getByText(/not an approval surface/i),
    ).toBeInTheDocument();
    // Body is not in the DOM until the toggle is clicked.
    expect(screen.queryByTestId('plan-narrative-body')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plan-narrative-toggle'));
    expect(screen.getByTestId('plan-narrative-body')).toBeInTheDocument();
  });
});

describe('PlanReviewDialog — reject flow', () => {
  it('reject submit requires a non-empty reason', () => {
    const onReject = vi.fn();
    render(
      <PlanReviewDialog
        plan={makePlan()}
        onApprove={() => {}}
        onReject={onReject}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('plan-reject-button'));
    const submit = screen.getByTestId('plan-reject-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('plan-reject-reason'), {
      target: { value: 'unsafe' },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onReject).toHaveBeenCalledWith('plan-test', 'unsafe');
  });
});

describe('PlanReviewDialog — already-executed plans are review-only', () => {
  it('disables approve even when fully acknowledged', () => {
    render(
      <PlanReviewDialog
        plan={makePlan()}
        alreadyExecuted
        onApprove={() => {}}
        onReject={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('acknowledge-a1'));
    fireEvent.click(screen.getByTestId('acknowledge-a2'));
    const approve = screen.getByTestId('plan-approve-button') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
  });
});

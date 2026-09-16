// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// FR-006 + SC-004 — predicted-vs-actual certificate rendering tests.
// Pin predicted-vs-actual certificate rendering and the diff function.

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  PlanCertificatePrediction,
  diffCertificate,
} from '../PlanCertificatePrediction';
import type {
  CertificateActual,
  CertificatePrediction,
} from '../planTypes';

afterEach(() => cleanup());

const prediction: CertificatePrediction = {
  adapter: 'acme-vue-node',
  stages: [
    {
      id: 's0-preflight',
      name: 'Pre-flight',
      artifacts: ['preflight.json'],
    },
    {
      id: 's1-business-requirements',
      name: 'Business Requirements',
      artifacts: ['brd.md'],
    },
  ],
};

describe('diffCertificate', () => {
  it('returns no discrepancies when prediction matches actual', () => {
    const actual: CertificateActual = {
      stages: [
        { id: 's0-preflight', name: 'Pre-flight', artifacts: ['preflight.json'] },
        {
          id: 's1-business-requirements',
          name: 'Business Requirements',
          artifacts: ['brd.md'],
        },
      ],
    };
    expect(diffCertificate(prediction, actual)).toEqual([]);
  });

  it('flags missing stages', () => {
    const actual: CertificateActual = {
      stages: [
        { id: 's0-preflight', name: 'Pre-flight', artifacts: ['preflight.json'] },
      ],
    };
    const d = diffCertificate(prediction, actual);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('missing-stage');
    expect(d[0].stageId).toBe('s1-business-requirements');
  });

  it('flags extra stages not in the prediction', () => {
    const actual: CertificateActual = {
      stages: [
        { id: 's0-preflight', name: 'Pre-flight', artifacts: ['preflight.json'] },
        {
          id: 's1-business-requirements',
          name: 'Business Requirements',
          artifacts: ['brd.md'],
        },
        { id: 's2-extra', name: 'Extra Stage', artifacts: [] },
      ],
    };
    const d = diffCertificate(prediction, actual);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('extra-stage');
    expect(d[0].stageId).toBe('s2-extra');
  });

  it('flags missing + extra artifacts within a stage', () => {
    const actual: CertificateActual = {
      stages: [
        { id: 's0-preflight', name: 'Pre-flight', artifacts: ['other.json'] },
        {
          id: 's1-business-requirements',
          name: 'Business Requirements',
          artifacts: ['brd.md'],
        },
      ],
    };
    const d = diffCertificate(prediction, actual);
    const kinds = d.map((x) => x.kind).sort();
    expect(kinds).toEqual(['extra-artifact', 'missing-artifact']);
  });
});

describe('PlanCertificatePrediction render', () => {
  it('marks stages as pending when no actual is provided', () => {
    render(<PlanCertificatePrediction prediction={prediction} />);
    const preflight = screen.getByTestId('cert-stage-s0-preflight');
    expect(preflight.getAttribute('data-status')).toBe('pending');
  });

  it('marks matched stages and surfaces "matches prediction" badge', () => {
    const actual: CertificateActual = {
      stages: [
        { id: 's0-preflight', name: 'Pre-flight', artifacts: ['preflight.json'] },
        {
          id: 's1-business-requirements',
          name: 'Business Requirements',
          artifacts: ['brd.md'],
        },
      ],
    };
    render(
      <PlanCertificatePrediction prediction={prediction} actual={actual} />,
    );
    const preflight = screen.getByTestId('cert-stage-s0-preflight');
    expect(preflight.getAttribute('data-status')).toBe('matched');
    expect(screen.getByTestId('cert-discrepancy-count').textContent).toContain(
      'matches prediction',
    );
  });

  it('surfaces the discrepancy list when the actual diverges', () => {
    const actual: CertificateActual = {
      stages: [
        { id: 's0-preflight', name: 'Pre-flight', artifacts: ['other.json'] },
      ],
    };
    render(
      <PlanCertificatePrediction prediction={prediction} actual={actual} />,
    );
    expect(
      screen.getByTestId('plan-certificate-prediction').getAttribute(
        'data-has-discrepancy',
      ),
    ).toBe('true');
    expect(screen.getByTestId('cert-discrepancy-list')).toBeInTheDocument();
  });
});

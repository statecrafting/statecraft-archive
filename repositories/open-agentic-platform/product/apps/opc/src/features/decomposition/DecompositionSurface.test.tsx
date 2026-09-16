// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/165-opc-decomposition-pipeline/spec.md — FR-001

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock at the apiAdapter boundary — api.ts calls apiCall(command, params).
const apiCallMock = vi.fn();
vi.mock('@/lib/apiAdapter', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}));

import { DecompositionSurface } from './DecompositionSurface';

const runFixture = {
  runId: '20260531-143025-100-000001-abcd1234',
  projectRoot: '/proj',
  schemaVersion: '0.1.0',
  startedAt: '2026-05-31T14:30:25Z',
  completedAt: '2026-05-31T14:30:30Z',
  stages: [
    {
      id: 'extraction',
      status: 'degraded',
      contentHash: 'h1',
      outputRelpath: 's1-extraction',
      degraded: 'no-knowledge-bundle',
    },
    { id: 'synthesis', status: 'complete', contentHash: 'h6', outputRelpath: 's6-synthesis' },
  ],
  emittedSpecs: [
    { slug: '999-decomposed-crates-c001', relpath: 'specs/999/spec.md', contentHash: 'sh1' },
  ],
  embeddingsEnabled: false,
  treeSignature: 'ts',
  knowledgeSignature: '',
  synthesiserIdentity: 'deterministic-baseline',
  promptTemplateHash: 'pth',
  checkpointAnchorId: 'anchor-x',
  checkpointTrajectoryId: 'traj-y',
};

const promotionFixture = {
  promotedRelpath: 'specs/042-demo/spec.md',
  compile: { ran: true, ok: true, detail: 'registry recompiled; validation passed' },
  coupling: { ran: false, ok: true, detail: 'coupling gate skipped (no binary supplied)' },
};

afterEach(() => {
  cleanup();
  apiCallMock.mockReset();
});

describe('DecompositionSurface', () => {
  it('lists prior runs on mount and shows staged drafts', async () => {
    apiCallMock.mockImplementation((cmd: string) => {
      if (cmd === 'decomposition_list_runs') return Promise.resolve([runFixture]);
      return Promise.resolve(null);
    });
    render(<DecompositionSurface projectPath="/proj" />);
    await waitFor(() => expect(screen.getByText(/Runs \(1\)/)).toBeInTheDocument());
    expect(screen.getByText(/999-decomposed-crates-c001/)).toBeInTheDocument();
    // Degraded stage badge surfaces.
    expect(screen.getByText(/extraction: degraded/)).toBeInTheDocument();
  });

  it('runs decomposition when the button is clicked', async () => {
    apiCallMock.mockImplementation((cmd: string) => {
      if (cmd === 'decomposition_list_runs') return Promise.resolve([]);
      if (cmd === 'decomposition_run') return Promise.resolve(runFixture);
      return Promise.resolve(null);
    });
    render(<DecompositionSurface projectPath="/proj" />);
    fireEvent.click(screen.getByText('Run decomposition'));
    await waitFor(() =>
      expect(apiCallMock).toHaveBeenCalledWith(
        'decomposition_run',
        expect.objectContaining({ projectPath: '/proj', embeddingsEnabled: false }),
      ),
    );
  });

  it('promotes a staged draft with a target slug', async () => {
    apiCallMock.mockImplementation((cmd: string) => {
      if (cmd === 'decomposition_list_runs') return Promise.resolve([runFixture]);
      if (cmd === 'decomposition_promote') return Promise.resolve(promotionFixture);
      return Promise.resolve(null);
    });
    render(<DecompositionSurface projectPath="/proj" />);
    await waitFor(() => screen.getByText(/999-decomposed-crates-c001/));

    fireEvent.change(screen.getByLabelText('target slug for 999-decomposed-crates-c001'), {
      target: { value: '042-demo' },
    });
    fireEvent.click(screen.getByText('Promote'));

    await waitFor(() => expect(screen.getByText(/Promoted →/)).toBeInTheDocument());
    expect(apiCallMock).toHaveBeenCalledWith(
      'decomposition_promote',
      expect.objectContaining({ targetSlug: '042-demo', stagedSlug: '999-decomposed-crates-c001' }),
    );
  });

  it('refuses to promote without a target slug', async () => {
    apiCallMock.mockImplementation((cmd: string) => {
      if (cmd === 'decomposition_list_runs') return Promise.resolve([runFixture]);
      return Promise.resolve(null);
    });
    render(<DecompositionSurface projectPath="/proj" />);
    await waitFor(() => screen.getByText(/999-decomposed-crates-c001/));
    fireEvent.click(screen.getByText('Promote'));
    await waitFor(() => expect(screen.getByText(/enter a target slug/)).toBeInTheDocument());
    expect(apiCallMock).not.toHaveBeenCalledWith('decomposition_promote', expect.anything());
  });

  it('shows an error banner when listing fails', async () => {
    apiCallMock.mockImplementation((cmd: string) => {
      if (cmd === 'decomposition_list_runs') return Promise.reject(new Error('boom'));
      return Promise.resolve(null);
    });
    render(<DecompositionSurface projectPath="/proj" />);
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });
});

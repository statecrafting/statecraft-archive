import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { ProjectCockpit, type FactoryProject } from '../ProjectCockpit';

const apiCallMock = vi.fn();

vi.mock('@/lib/apiAdapter', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}));

beforeEach(() => {
  apiCallMock.mockReset();
});

afterEach(() => {
  cleanup();
});

function makeAcpProject(): FactoryProject {
  return {
    level: 'acp_produced',
    adapter_ref: { name: 'acme-vue-node', version: '3.0.0' },
    pipeline_state: {
      schema_version: '1.0.0',
      pipeline: {
        id: '11111111-2222-3333-4444-555555555555',
        factory_version: '0.1.0',
        started_at: '2026-04-22T00:00:00Z',
        updated_at: '2026-04-22T00:00:00Z',
        status: 'running',
        adapter: { name: 'acme-vue-node', version: '3.0.0' },
        build_spec: { path: 'build-spec.yaml', hash: 'abc' },
      },
      stages: {
        'pre-flight': { status: 'completed', completed_at: '2026-04-22T00:00:00Z' },
        'business-requirements': {
          status: 'in_progress',
          started_at: '2026-04-22T01:00:00Z',
        },
      },
    },
  };
}

describe('ProjectCockpit', () => {
  it('shows "Not a factory project" when detection returns not_factory', async () => {
    apiCallMock.mockResolvedValue({ ok: true, project: { level: 'not_factory' } });
    render(<ProjectCockpit projectPath="/tmp/plain" />);
    await waitFor(() => {
      expect(
        screen.getByText(/This directory is not a factory project/i)
      ).toBeInTheDocument();
    });
  });

  it('renders adapter identity and stage timeline for an ACP-produced project', async () => {
    apiCallMock.mockResolvedValue({ ok: true, project: makeAcpProject() });
    render(<ProjectCockpit projectPath="/tmp/proj" />);
    await waitFor(() => {
      expect(screen.getByText(/acme-vue-node/)).toBeInTheDocument();
    });
    expect(screen.getByText('pre-flight')).toBeInTheDocument();
    expect(screen.getByText('business-requirements')).toBeInTheDocument();
    // Default Run Stage button labels with the first rendered stage.
    expect(screen.getByRole('button', { name: /Run Stage \(/ })).toBeInTheDocument();
  });

  it('flags legacy-incomplete projects with the list of missing stages', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      project: {
        level: 'legacy_produced',
        adapter_ref: { name: 'acme-vue-node', version: '3.0.0' },
        legacy_complete: false,
        legacy_incomplete_stages: ['stage3_databaseDesign', 'stage4_apiControllers'],
      },
    });
    render(<ProjectCockpit projectPath="/tmp/partial" />);
    await waitFor(() => {
      expect(screen.getByText(/Legacy pipeline incomplete/i)).toBeInTheDocument();
    });
    expect(screen.getByText('stage3_databaseDesign')).toBeInTheDocument();
    expect(screen.getByText('stage4_apiControllers')).toBeInTheDocument();
  });

  it('calls onRunStage when the Run Stage button is clicked', async () => {
    apiCallMock.mockResolvedValue({ ok: true, project: makeAcpProject() });
    const onRunStage = vi.fn();
    render(<ProjectCockpit projectPath="/tmp/proj" onRunStage={onRunStage} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Run Stage \(/ })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Run Stage \(/ }));
    expect(onRunStage).toHaveBeenCalledWith('pre-flight');
  });

  it('surfaces a detection error when the Tauri command fails', async () => {
    apiCallMock.mockRejectedValue(new Error('boom'));
    render(<ProjectCockpit projectPath="/tmp/bad" />);
    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
  });
});

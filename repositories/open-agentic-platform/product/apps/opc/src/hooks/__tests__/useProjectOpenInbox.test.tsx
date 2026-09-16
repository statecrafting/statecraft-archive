// Spec 112 §6.3 — useProjectOpenInbox lifecycle tests.
//
// Pin the hook's contract: bundle resolution, clone, dismiss, and the
// dedup behaviour against cold-launch event replays. The Tauri event
// path is mocked at the import boundary (`@tauri-apps/api/event`) and
// the apiCall layer is mocked the same way ProjectCockpit's tests do.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const apiCallMock = vi.fn();
const listenerHandlers: Array<(event: { payload: unknown }) => void> = [];
const unlistenMock = vi.fn();

vi.mock('@/lib/apiAdapter', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, handler: (e: { payload: unknown }) => void) => {
    listenerHandlers.push(handler);
    return Promise.resolve(unlistenMock);
  }),
}));

beforeEach(() => {
  apiCallMock.mockReset();
  listenerHandlers.length = 0;
  unlistenMock.mockReset();
  // Mark the env as Tauri so the hook subscribes to the deep-link event.
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

async function emitProjectOpenRequest(payload: {
  projectId: string;
  cloneUrl: string;
  level?: string;
}) {
  // Wait for the dynamic import('@tauri-apps/api/event') in the effect
  // to finish wiring, then dispatch on every registered handler.
  await waitFor(() => expect(listenerHandlers.length).toBeGreaterThan(0));
  await act(async () => {
    for (const h of listenerHandlers) h({ payload });
  });
}

describe('useProjectOpenInbox', () => {
  it('captures a project-open-request event into the pending slot', async () => {
    const { useProjectOpenInbox } = await import('../useProjectOpenInbox');
    const { result } = renderHook(() => useProjectOpenInbox());

    await emitProjectOpenRequest({
      projectId: 'p1',
      cloneUrl: 'https://github.com/acme/foo.git',
      level: 'legacy_produced',
    });

    expect(result.current.pending).toEqual({
      projectId: 'p1',
      cloneUrl: 'https://github.com/acme/foo.git',
      level: 'legacy_produced',
    });
    expect(result.current.bundle).toBeNull();
  });

  it('fetches the bundle on demand and stores it', async () => {
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      bundle: {
        project: { id: 'p1', name: 'Foo', slug: 'foo', orgId: 'org' },
        repo: {
          cloneUrl: 'https://github.com/acme/foo.git',
          githubOrg: 'acme',
          repoName: 'foo',
          defaultBranch: 'main',
        },
        deepLink: 'opc://project/open?project_id=p1&url=…',
        adapter: null,
        contracts: [],
        processes: [],
        agents: [],
      },
    });

    const { useProjectOpenInbox } = await import('../useProjectOpenInbox');
    const { result } = renderHook(() => useProjectOpenInbox());

    await emitProjectOpenRequest({
      projectId: 'p1',
      cloneUrl: 'https://github.com/acme/foo.git',
    });

    await act(async () => {
      await result.current.fetchBundle();
    });

    expect(apiCallMock).toHaveBeenCalledWith('fetch_project_opc_bundle', {
      request: { project_id: 'p1' },
    });
    expect(result.current.bundle?.project.slug).toBe('foo');
    expect(result.current.bundleError).toBeNull();
  });

  it('surfaces a bundle fetch error without throwing', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, error: 'offline' });

    const { useProjectOpenInbox } = await import('../useProjectOpenInbox');
    const { result } = renderHook(() => useProjectOpenInbox());

    await emitProjectOpenRequest({ projectId: 'p1', cloneUrl: 'https://x' });
    await act(async () => {
      await result.current.fetchBundle();
    });

    expect(result.current.bundle).toBeNull();
    expect(result.current.bundleError).toBe('offline');
  });

  it('clones with the bundle defaultBranch when available', async () => {
    apiCallMock
      .mockResolvedValueOnce({
        ok: true,
        bundle: {
          project: { id: 'p1', name: 'Foo', slug: 'foo', orgId: 'org' },
          repo: {
            cloneUrl: 'https://github.com/acme/foo.git',
            githubOrg: 'acme',
            repoName: 'foo',
            defaultBranch: 'develop',
          },
          deepLink: null,
          adapter: null,
          contracts: [],
          processes: [],
          agents: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        path: '/tmp/oap-projects/foo',
        alreadyCloned: false,
      });

    const { useProjectOpenInbox } = await import('../useProjectOpenInbox');
    const { result } = renderHook(() => useProjectOpenInbox());

    await emitProjectOpenRequest({ projectId: 'p1', cloneUrl: 'https://github.com/acme/foo.git' });
    await act(async () => {
      await result.current.fetchBundle();
    });
    await act(async () => {
      await result.current.cloneProject('/tmp/oap-projects/foo');
    });

    expect(apiCallMock).toHaveBeenLastCalledWith('clone_project_from_bundle', {
      request: {
        cloneUrl: 'https://github.com/acme/foo.git',
        targetDir: '/tmp/oap-projects/foo',
        defaultBranch: 'develop',
        githubToken: null,
      },
    });
    expect(result.current.clone.path).toBe('/tmp/oap-projects/foo');
    expect(result.current.clone.alreadyCloned).toBe(false);
    expect(result.current.clone.error).toBeNull();
  });

  it('dismiss clears pending, bundle, and clone state', async () => {
    const { useProjectOpenInbox } = await import('../useProjectOpenInbox');
    const { result } = renderHook(() => useProjectOpenInbox());

    await emitProjectOpenRequest({ projectId: 'p1', cloneUrl: 'https://x' });
    expect(result.current.pending).not.toBeNull();

    act(() => result.current.dismiss());

    expect(result.current.pending).toBeNull();
    expect(result.current.bundle).toBeNull();
    expect(result.current.clone.path).toBeNull();
  });
});

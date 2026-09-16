// Spec 112 §6.4.4 — useCloneTokenRefresh tests.
//
// Pin three invariants:
//   1. Initial bundle token is persisted to keychain on mount.
//   2. Refresh fires *before* expiry (5-min default window).
//   3. invalidate() against a project_github_pat that re-resolves to
//      itself surfaces `pat_invalid` so the UI can guide the user to
//      Statecraft instead of looping.
//
// `refreshDelayMs` is also covered as a pure helper for boundary
// conditions.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  __test__,
  patSettingsUrl,
  useCloneTokenRefresh,
} from '../useCloneTokenRefresh';

const cloneTokenStoreMock = vi.fn();
const cloneTokenLoadMock = vi.fn();
const cloneTokenClearMock = vi.fn();
const refreshCloneTokenMock = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    cloneTokenStore: (...args: unknown[]) => cloneTokenStoreMock(...args),
    cloneTokenLoad: (...args: unknown[]) => cloneTokenLoadMock(...args),
    cloneTokenClear: (...args: unknown[]) => cloneTokenClearMock(...args),
    refreshCloneToken: (...args: unknown[]) => refreshCloneTokenMock(...args),
  },
}));

beforeEach(() => {
  cloneTokenStoreMock.mockReset();
  cloneTokenStoreMock.mockResolvedValue(undefined);
  cloneTokenLoadMock.mockReset();
  cloneTokenLoadMock.mockResolvedValue(null);
  cloneTokenClearMock.mockReset();
  cloneTokenClearMock.mockResolvedValue(undefined);
  refreshCloneTokenMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('refreshDelayMs', () => {
  it('returns null when expiresAt is null (PATs)', () => {
    expect(__test__.refreshDelayMs(null, 5)).toBeNull();
    expect(__test__.refreshDelayMs(undefined, 5)).toBeNull();
  });

  it('returns 0 when the window has already passed', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(__test__.refreshDelayMs(past, 5)).toBe(0);
  });

  it('returns a positive delay when expiry is far in the future', () => {
    const oneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const delay = __test__.refreshDelayMs(oneHour, 5);
    // 1h - 5min = 55min ≈ 3,300,000 ms; allow generous slack for the
    // few microseconds of clock movement between calls.
    expect(delay).toBeGreaterThan(3_290_000);
    expect(delay).toBeLessThan(3_310_000);
  });

  it('returns null on unparseable input', () => {
    expect(__test__.refreshDelayMs('not-a-date', 5)).toBeNull();
  });
});

describe('patSettingsUrl', () => {
  it('joins base URL and project path with proper escaping', () => {
    expect(patSettingsUrl('https://statecraft.example.com/', 'p:1')).toBe(
      'https://statecraft.example.com/app/project/p%3A1/settings/github-pat'
    );
  });

  it('strips trailing slashes from the base URL', () => {
    expect(patSettingsUrl('https://x.test///', 'abc')).toBe(
      'https://x.test/app/project/abc/settings/github-pat'
    );
  });
});

describe('useCloneTokenRefresh', () => {
  it('persists the bundle token to keychain on mount', async () => {
    const { result } = renderHook(() =>
      useCloneTokenRefresh({
        projectId: 'p-1',
        initialToken: {
          value: 'ghs_FAKE',
          source: 'github_installation',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      })
    );

    await waitFor(() => expect(result.current.status).toBe('fresh'));
    expect(cloneTokenStoreMock).toHaveBeenCalledWith(
      'p-1',
      'ghs_FAKE',
      'github_installation',
      expect.any(String)
    );
    expect(result.current.token?.value).toBe('ghs_FAKE');
  });

  it('marks status anonymous when the bundle has no token', async () => {
    const { result } = renderHook(() =>
      useCloneTokenRefresh({ projectId: 'p-2', initialToken: null })
    );
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(cloneTokenClearMock).toHaveBeenCalledWith('p-2');
    expect(result.current.token).toBeNull();
  });

  it('schedules a refresh just before the installation token expires', async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    refreshCloneTokenMock.mockResolvedValue({
      ok: true,
      token: {
        value: 'ghs_NEW',
        source: 'github_installation',
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
    });

    const { result } = renderHook(() =>
      useCloneTokenRefresh({
        projectId: 'p-3',
        initialToken: {
          value: 'ghs_OLD',
          source: 'github_installation',
          expiresAt,
        },
      })
    );

    // Flush the persist effect (microtasks). useFakeTimers does not
    // mock microtasks by default, so we need to await once.
    await vi.waitFor(() => expect(result.current.token?.value).toBe('ghs_OLD'));

    // 5-minute window means refresh fires at expiry - 5min.
    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000 - 5 * 60 * 1000 + 100);
    });

    await vi.waitFor(() => expect(refreshCloneTokenMock).toHaveBeenCalledWith('p-3'));
    await vi.waitFor(() => expect(result.current.token?.value).toBe('ghs_NEW'));
  });

  it('invalidate against a project_github_pat surfaces pat_invalid', async () => {
    refreshCloneTokenMock.mockResolvedValue({
      ok: true,
      token: {
        value: 'ghp_BROKEN',
        source: 'project_github_pat',
        expires_at: null,
      },
    });

    const { result } = renderHook(() =>
      useCloneTokenRefresh({
        projectId: 'p-4',
        initialToken: {
          value: 'ghp_BROKEN',
          source: 'project_github_pat',
          expiresAt: null,
        },
      })
    );
    await waitFor(() => expect(result.current.status).toBe('fresh'));

    await act(async () => {
      await result.current.invalidate();
    });

    await waitFor(() => expect(result.current.status).toBe('pat_invalid'));
    expect(cloneTokenClearMock).toHaveBeenCalledWith('p-4');
  });

  it('invalidate against an installation token cycles cleanly back to fresh', async () => {
    refreshCloneTokenMock.mockResolvedValue({
      ok: true,
      token: {
        value: 'ghs_REMINTED',
        source: 'github_installation',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });

    const { result } = renderHook(() =>
      useCloneTokenRefresh({
        projectId: 'p-5',
        initialToken: {
          value: 'ghs_OLD',
          source: 'github_installation',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      })
    );
    await waitFor(() => expect(result.current.status).toBe('fresh'));

    await act(async () => {
      await result.current.invalidate();
    });

    await waitFor(() => expect(result.current.token?.value).toBe('ghs_REMINTED'));
    expect(result.current.status).toBe('fresh');
  });

  it('refresh propagates Statecraft 503 / network errors as status=error', async () => {
    refreshCloneTokenMock.mockResolvedValue({
      ok: false,
      error: 'statecraft 503: clone token resolution failed',
    });

    const { result } = renderHook(() =>
      useCloneTokenRefresh({
        projectId: 'p-6',
        initialToken: {
          value: 'ghs_OK',
          source: 'github_installation',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      })
    );
    await waitFor(() => expect(result.current.status).toBe('fresh'));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toContain('clone token resolution failed');
  });
});

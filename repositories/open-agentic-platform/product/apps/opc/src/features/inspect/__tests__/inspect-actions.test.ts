import { describe, it, expect } from 'vitest';
import { resolveSpecAbsolutePath, getSpecActionsFromRegistry } from '../actions';

describe('resolveSpecAbsolutePath', () => {
  it('joins repo root with posix spec path', () => {
    expect(resolveSpecAbsolutePath('/repo', 'specs/032-opc-inspect-governance-wiring-mvp/spec.md')).toBe(
      '/repo/specs/032-opc-inspect-governance-wiring-mvp/spec.md'
    );
  });

  it('trims slashes', () => {
    expect(resolveSpecAbsolutePath('/repo/', '/specs/a/spec.md')).toBe('/repo/specs/a/spec.md');
  });
});

describe('getSpecActionsFromRegistry', () => {
  it('returns empty when registry unavailable', () => {
    expect(
      getSpecActionsFromRegistry({
        status: 'unavailable',
        path: '/x',
        message: 'missing',
      })
    ).toEqual([]);
  });

  it('returns feature summaries when registry ok', () => {
    const actions = getSpecActionsFromRegistry({
      status: 'ok',
      path: '/r',
      summary: {
        featureCount: 1,
        validationPassed: true,
        violationsCount: 0,
        statusCounts: {},
        featureSummaries: [{ id: '032-x', title: 'Feature', specPath: 'specs/032-x/spec.md' }],
      },
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].specPath).toBe('specs/032-x/spec.md');
  });
});

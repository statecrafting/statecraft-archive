// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 112 §7 / Phase 8 — unit tests for the workspace project catalog
// store reducer. Covers upsert insert, upsert update, tombstone removal,
// and localPath preservation across upserts (which is the bit a naive
// "replace the whole entry" reducer would silently drop).

import { beforeEach, describe, expect, test } from 'vitest';
import {
  selectProjectsList,
  useProjectCatalogStore,
} from '../projectCatalogStore';

const baseEvent = {
  projectId: 'p-1',
  orgId: 'org-1',
  name: 'Alpha',
  slug: 'alpha',
  description: 'first project',
  factoryAdapterId: 'ad-1',
  detectionLevel: 'scaffold_only' as const,
  repo: {
    githubOrg: 'acme',
    repoName: 'alpha',
    defaultBranch: 'main',
    cloneUrl: 'https://github.com/acme/alpha.git',
    htmlUrl: 'https://github.com/acme/alpha',
  },
  opcDeepLink: 'opc://project/open?project_id=p-1',
  tombstone: false,
  updatedAt: '2026-04-27T00:00:00Z',
};

describe('projectCatalogStore', () => {
  beforeEach(() => {
    useProjectCatalogStore.getState().reset();
  });

  test('inserts a new project on first upsert and marks the store hydrated', () => {
    const { applyUpsert } = useProjectCatalogStore.getState();
    expect(useProjectCatalogStore.getState().hydrated).toBe(false);

    applyUpsert(baseEvent);

    const state = useProjectCatalogStore.getState();
    expect(state.hydrated).toBe(true);
    expect(selectProjectsList(state)).toHaveLength(1);
    expect(selectProjectsList(state)[0]).toMatchObject({
      projectId: 'p-1',
      name: 'Alpha',
      detectionLevel: 'scaffold_only',
    });
  });

  test('replaces fields on a follow-up upsert without losing the row', () => {
    const { applyUpsert } = useProjectCatalogStore.getState();
    applyUpsert(baseEvent);
    applyUpsert({ ...baseEvent, name: 'Alpha Renamed', detectionLevel: 'acp_produced' });

    const list = selectProjectsList(useProjectCatalogStore.getState());
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Alpha Renamed');
    expect(list[0].detectionLevel).toBe('acp_produced');
  });

  test('tombstone drops the row but keeps hydrated true', () => {
    const { applyUpsert } = useProjectCatalogStore.getState();
    applyUpsert(baseEvent);
    applyUpsert({ ...baseEvent, tombstone: true });

    const state = useProjectCatalogStore.getState();
    expect(state.hydrated).toBe(true);
    expect(selectProjectsList(state)).toHaveLength(0);
  });

  test('tombstone for an unknown project is a no-op but still hydrates', () => {
    const { applyUpsert } = useProjectCatalogStore.getState();
    applyUpsert({ ...baseEvent, projectId: 'p-unknown', tombstone: true });

    const state = useProjectCatalogStore.getState();
    expect(state.hydrated).toBe(true);
    expect(selectProjectsList(state)).toHaveLength(0);
  });

  test('preserves localPath across follow-up upserts (server doesn\'t carry it)', () => {
    const { applyUpsert } = useProjectCatalogStore.getState();
    applyUpsert(baseEvent);
    // Simulate a clone command that decorated the entry with a localPath.
    useProjectCatalogStore.setState((state) => ({
      byId: {
        ...state.byId,
        'p-1': { ...state.byId['p-1'], localPath: '/tmp/clones/alpha' },
      },
    }));
    applyUpsert({ ...baseEvent, name: 'Alpha v2' });

    const list = selectProjectsList(useProjectCatalogStore.getState());
    expect(list[0].name).toBe('Alpha v2');
    expect(list[0].localPath).toBe('/tmp/clones/alpha');
  });

  test('reset clears state', () => {
    const { applyUpsert, reset } = useProjectCatalogStore.getState();
    applyUpsert(baseEvent);
    reset();
    const state = useProjectCatalogStore.getState();
    expect(state.hydrated).toBe(false);
    expect(selectProjectsList(state)).toHaveLength(0);
  });
});

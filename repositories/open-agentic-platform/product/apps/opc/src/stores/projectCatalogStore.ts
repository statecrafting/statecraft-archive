// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 112 §7 / Phase 8 (amended) — workspace project catalog store.
//
// Subscribes to two Tauri events emitted by
// `commands::project_catalog_sync`:
//
//   * `project-catalog-upsert`           — one per project row (live + replay)
//   * `project-catalog-snapshot-complete` — handshake snapshot terminator
//
// The store maintains an in-memory list of projects keyed on `projectId`;
// tombstones drop the row. `hydrated` flips on the FIRST of either event,
// so the panel can distinguish "still connecting" from "connected; zero
// projects" without an arbitrary client-side timeout (the previous
// timeout band-aid was retired with the snapshot.complete envelope).
//
// Restart and reconnect both replay through the duplex handshake
// snapshot, so the store does not need to persist — a missed upsert
// becomes a clean rebuild on the next handshake.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ProjectCatalogEntry } from '@/routes/factory/ProjectsPanel';

interface ProjectCatalogUpsertEventPayload {
  projectId: string;
  orgId: string;
  name: string;
  slug: string;
  description: string;
  factoryAdapterId: string | null;
  detectionLevel: ProjectCatalogEntry['detectionLevel'];
  repo: ProjectCatalogEntry['repo'];
  opcDeepLink: string;
  tombstone: boolean;
  updatedAt: string;
}

interface ProjectCatalogSnapshotCompleteEventPayload {
  orgId: string;
  entryCount: number;
  generatedAt: string;
}

interface ProjectCatalogState {
  /** Map of projectId -> entry. Kept as an object for fast lookups; the
   *  panel sorts when it renders. */
  byId: Record<string, ProjectCatalogEntry>;
  /** Set when the desktop has received either at least one upsert OR an
   *  explicit snapshot-complete frame. Lets the panel distinguish "no
   *  projects yet" from "haven't heard from statecraft yet". */
  hydrated: boolean;
  applyUpsert: (payload: ProjectCatalogUpsertEventPayload) => void;
  markSnapshotComplete: () => void;
  reset: () => void;
}

export const useProjectCatalogStore = create<ProjectCatalogState>()(
  subscribeWithSelector((set) => ({
    byId: {},
    hydrated: false,
    applyUpsert: (payload) =>
      set((state) => {
        if (payload.tombstone) {
          if (!state.byId[payload.projectId]) {
            return { hydrated: true };
          }
          const next = { ...state.byId };
          delete next[payload.projectId];
          return { byId: next, hydrated: true };
        }
        const entry: ProjectCatalogEntry = {
          projectId: payload.projectId,
          orgId: payload.orgId,
          name: payload.name,
          slug: payload.slug,
          description: payload.description,
          factoryAdapterId: payload.factoryAdapterId,
          detectionLevel: payload.detectionLevel,
          repo: payload.repo,
          opcDeepLink: payload.opcDeepLink,
          updatedAt: payload.updatedAt,
          localPath: state.byId[payload.projectId]?.localPath,
        };
        return {
          byId: { ...state.byId, [payload.projectId]: entry },
          hydrated: true,
        };
      }),
    markSnapshotComplete: () => set({ hydrated: true }),
    reset: () => set({ byId: {}, hydrated: false }),
  }))
);

/**
 * Subscribe to the Tauri event stream and dispatch upserts into the
 * store. Returns an unsubscribe function that detaches both listeners.
 * No-op outside Tauri so the webview build doesn't crash on
 * `import("@tauri-apps/api/event")`.
 */
export async function subscribeProjectCatalog(): Promise<() => void> {
  if (!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return () => {};
  }
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');
  const { applyUpsert, markSnapshotComplete } = useProjectCatalogStore.getState();
  const unlistenUpsert = await listen<ProjectCatalogUpsertEventPayload>(
    'project-catalog-upsert',
    (event) => {
      applyUpsert(event.payload);
    }
  );
  const unlistenComplete = await listen<ProjectCatalogSnapshotCompleteEventPayload>(
    'project-catalog-snapshot-complete',
    () => {
      markSnapshotComplete();
    }
  );

  // Pull-after-subscribe (spec 112 §7). The duplex handshake snapshot is
  // delivered ONCE, before this panel mounts — the panel renders only
  // after the boot gate opens, and the boot gate opens only after the
  // handshake (`sync.hello`). Tauri does not buffer events for listeners
  // attached later, so without this pull the store could stay
  // un-hydrated forever ("Connecting to statecraft…") until the next
  // duplex reconnect. The Rust side caches the catalog; we pull it AFTER
  // attaching the live listeners above, so any frame delivered between the
  // pull and now is still captured (applyUpsert is idempotent by id).
  try {
    const snapshot = await invoke<{
      entries: ProjectCatalogUpsertEventPayload[];
      hydrated: boolean;
    }>('get_project_catalog');
    for (const entry of snapshot.entries) {
      applyUpsert(entry);
    }
    if (snapshot.hydrated) {
      markSnapshotComplete();
    }
  } catch (err) {
    // Non-fatal: a later upsert or a duplex reconnect still hydrates.
    console.warn('[projectCatalogStore] get_project_catalog pull failed:', err);
  }

  return () => {
    unlistenUpsert();
    unlistenComplete();
  };
}

/** Selector helper — the panel wants a sorted array, not the map. */
export function selectProjectsList(state: ProjectCatalogState): ProjectCatalogEntry[] {
  return Object.values(state.byId);
}

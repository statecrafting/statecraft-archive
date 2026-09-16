// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 112 §7 / Phase 8 — connects the duplex-synced project catalog
// store to the presentational ProjectsPanel and surfaces "open" /
// "clone & open" actions wired to the existing factory tab handler.

import React, { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Card } from '@opc/ui/card';
import { useTabState } from '@/hooks/useTabState';
import {
  selectProjectsList,
  subscribeProjectCatalog,
  useProjectCatalogStore,
} from '@/stores/projectCatalogStore';
import { ProjectsPanel, type ProjectCatalogEntry } from './ProjectsPanel';

export const WorkspaceProjectsPanel: React.FC = () => {
  const projects = useProjectCatalogStore(useShallow(selectProjectsList));
  const hydrated = useProjectCatalogStore((s) => s.hydrated);
  const { createFactoryTab } = useTabState();

  // Subscribe to the duplex catalog stream once. The store is global, so the
  // subscription survives panel unmounts and remounts — but we still need
  // *some* component to wire it up at app load. The Projects tab is a fine
  // owner because it is the only consumer today.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void subscribeProjectCatalog().then((u) => {
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleOpen = (project: ProjectCatalogEntry) => {
    if (!project.localPath) return;
    createFactoryTab(project.localPath);
  };

  // "Clone & open" routes the user through the proven Open-in-OPC handoff:
  // we re-emit the same `project-open-request` event that the OS deep-link
  // dispatcher (commands::project_open) fires for an
  // `opc://project/open?...` URL, so the inbox banner resolves the bundle,
  // clones with a real clone token, and activates the cockpit.
  //
  // The previous `window.location.assign(project.opcDeepLink)` was a no-op:
  // the Tauri webview does not route `window.location` navigations to the
  // OS `opc://` URI handler, so the click did nothing. Emitting the event
  // in-process reaches the inbox listener directly without bouncing through
  // the OS scheme handler.
  const handleClone = (project: ProjectCatalogEntry) => {
    const cloneUrl = project.repo?.cloneUrl;
    if (!cloneUrl) return;
    const level =
      project.detectionLevel === 'scaffold_only' ||
      project.detectionLevel === 'legacy_produced' ||
      project.detectionLevel === 'acp_produced'
        ? project.detectionLevel
        : undefined;
    void import('@tauri-apps/api/event').then(({ emit }) => {
      void emit('project-open-request', {
        projectId: project.projectId,
        cloneUrl,
        level,
      });
    });
  };

  if (!hydrated) {
    // Statecraft sends an explicit project.catalog.snapshot.complete envelope
    // at the end of the handshake even when the org has zero projects, so
    // !hydrated genuinely means "duplex handshake hasn't finished yet". The
    // duplex client retries with backoff if the connection drops — if this
    // message sticks for more than a few seconds, the duplex isn't reaching
    // statecraft (check Settings → Statecraft).
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Card className="p-4 text-sm">
          Connecting to statecraft… the project list will arrive once the
          duplex handshake completes.
        </Card>
      </div>
    );
  }

  return (
    <ProjectsPanel
      projects={projects}
      onOpen={handleOpen}
      onClone={handleClone}
    />
  );
};

export default WorkspaceProjectsPanel;

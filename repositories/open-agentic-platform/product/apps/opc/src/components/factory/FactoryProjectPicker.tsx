// Spec 112 §6.3 — Factory project picker.
//
// Lists workspace projects from the duplex-synced catalog and opens the
// selected one through `useFactoryProjectOpener`. This is the in-app
// equivalent of statecraft's "Open in OPC" deep link — same primitives
// (`fetch_project_opc_bundle` + `clone_project_from_bundle`), just driven
// from a project picker instead of a URL handoff.
//
// The duplex catalog can be empty, late, or unavailable (e.g. user just
// signed in and Statecraft hasn't replayed its handshake snapshot yet),
// so the panel always exposes a manual entry field. The user can paste an
// `opc://project/open?...` deep link or a raw project id and the picker
// resolves it through the same opener — this is the flow statecraft's
// success page would have triggered, only without the URL hop.

import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AlertCircle,
  ExternalLink,
  Folder,
  FolderDown,
  Link2,
  RefreshCw,
  Workflow,
} from 'lucide-react';
import { Badge } from '@opc/ui/badge';
import { Button } from '@opc/ui/button';
import { Card } from '@opc/ui/card';
import { Input } from '@opc/ui/input';
import {
  selectProjectsList,
  subscribeProjectCatalog,
  useProjectCatalogStore,
} from '@/stores/projectCatalogStore';
import { useFactoryProjectOpener } from '@/hooks/useFactoryProjectOpener';
import type { ProjectCatalogEntry } from '@/routes/factory/ProjectsPanel';
import type { OpcBundle } from '@/types/factoryBundle';

export interface FactoryProjectPickerProps {
  /** Called after a successful resolve+clone. Caller updates the Factory tab. */
  onOpened: (path: string, bundle: OpcBundle) => void;
  /** Optional id of the project currently loaded in the tab. The matching row
   *  shows an "active" badge and disables its button. */
  activeProjectId?: string;
  /** Optional cancel handler. Renders a "Cancel" button when provided — used
   *  by the modal/inline picker overlay to dismiss without picking. */
  onCancel?: () => void;
  /** Compact mode: tighter spacing for the modal overlay. */
  variant?: 'fullscreen' | 'modal';
}

/**
 * Best-effort extraction of a project id from raw user input. Accepts:
 *   - opc://project/open?projectId=<id>&cloneUrl=...
 *   - https://statecraft.example/app/project/<id>/...
 *   - <id> (raw uuid)
 *
 * Returns the trimmed input verbatim if no recognised shape matches — the
 * caller's `fetch_project_opc_bundle` will reject unknown ids with a clear
 * error, which is more informative than rejecting client-side here.
 */
export function extractProjectIdFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // opc://project/open?projectId=...
  try {
    const url = new URL(trimmed);
    const queryId = url.searchParams.get('projectId') ?? url.searchParams.get('project_id');
    if (queryId) return queryId;
    // Path-style fallback: /app/project/<id>/...
    const match = url.pathname.match(/\/project\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch {
    // not a parseable URL — fall through and treat as raw id
  }
  return trimmed;
}

export const FactoryProjectPicker: React.FC<FactoryProjectPickerProps> = ({
  onOpened,
  activeProjectId,
  onCancel,
  variant = 'fullscreen',
}) => {
  const projects = useProjectCatalogStore(useShallow(selectProjectsList));
  const hydrated = useProjectCatalogStore((s) => s.hydrated);
  const opener = useFactoryProjectOpener();
  const [manualInput, setManualInput] = useState('');

  // The catalog store is global; this is the panel that wires up the duplex
  // subscription if no other consumer has already done so. The unsubscribe
  // is idempotent on the Tauri side.
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

  const sorted = [...projects].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

  const busy = opener.status === 'resolving' || opener.status === 'cloning';

  const handleOpenById = async (projectId: string) => {
    if (!projectId) return;
    const result = await opener.open(projectId);
    if (result) onOpened(result.path, result.bundle);
  };

  const handleOpenFromCard = (project: ProjectCatalogEntry) => {
    if (!project.repo) return;
    void handleOpenById(project.projectId);
  };

  const handleSubmitManual = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const id = extractProjectIdFromInput(manualInput);
    if (!id) return;
    void handleOpenById(id);
  };

  const containerClass =
    variant === 'modal'
      ? 'flex flex-col gap-2 p-3 max-h-[70vh] overflow-y-auto'
      : 'h-full flex flex-col p-3 gap-2 overflow-y-auto';

  return (
    <div className={containerClass}>
      <div className="flex items-center gap-2 px-1 pt-1">
        <Folder className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold flex-1">
          Open a project in Factory
        </h2>
        {hydrated && (
          <span className="text-xs text-muted-foreground">{sorted.length}</span>
        )}
      </div>

      {/* Manual entry — always available so the picker works before the
          duplex catalog hydrates (or when it stays empty). */}
      <form
        onSubmit={handleSubmitManual}
        className="rounded-md border border-border/60 bg-muted/30 p-2.5 space-y-2"
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          <span>
            Paste an <span className="font-mono">opc://project/open?…</span> URL
            or project id
          </span>
        </div>
        <div className="flex gap-2">
          <Input
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="opc://project/open?projectId=…"
            className="h-8 text-xs font-mono"
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy || !manualInput.trim()}
          >
            {busy && opener.step ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {opener.step}
              </>
            ) : (
              <>
                <FolderDown className="h-3.5 w-3.5 mr-1.5" />
                Open
              </>
            )}
          </Button>
        </div>
      </form>

      {opener.error && (
        <Card className="p-2.5 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="break-words">{opener.error}</span>
          </div>
        </Card>
      )}

      {/* Synced catalog — distinguish "still connecting" from "connected,
          empty workspace" so the user knows whether to wait or sign in. */}
      {!hydrated ? (
        <Card className="p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            <span>
              Waiting for statecraft project snapshot — projects will appear
              here once the duplex sync replays its handshake. You can still
              open a project by pasting its URL above.
            </span>
          </div>
        </Card>
      ) : sorted.length === 0 ? (
        <Card className="p-3 text-xs text-muted-foreground">
          No projects synced from statecraft yet. Create or import one there
          and the catalog will broadcast it here automatically.
        </Card>
      ) : null}

      {sorted.map((project) => {
        const isActive = activeProjectId === project.projectId;
        const noRepo = !project.repo;
        const disabled = busy || isActive || noRepo;
        return (
          <Card key={project.projectId} className="p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium flex-1 truncate">
                {project.name}
              </span>
              {isActive && (
                <Badge variant="secondary" className="text-xs">
                  active
                </Badge>
              )}
              {project.factoryAdapterId && (
                <Badge
                  variant="outline"
                  className="text-xs font-mono"
                  title={`Factory adapter: ${project.factoryAdapterId}`}
                >
                  {project.factoryAdapterId}
                </Badge>
              )}
            </div>
            {project.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {project.description}
              </p>
            )}
            {project.repo && (
              <div className="text-xs font-mono text-muted-foreground truncate">
                {project.repo.githubOrg}/{project.repo.repoName}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => handleOpenFromCard(project)}
                disabled={disabled}
                title={
                  noRepo
                    ? 'Project has no repo configured in statecraft'
                    : isActive
                      ? 'Already open in this Factory tab'
                      : undefined
                }
              >
                {isActive ? (
                  <>
                    <Workflow className="h-3.5 w-3.5 mr-1.5" />
                    Already open
                  </>
                ) : busy && opener.step ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    {opener.step}
                  </>
                ) : (
                  <>
                    <FolderDown className="h-3.5 w-3.5 mr-1.5" />
                    Open in Factory
                  </>
                )}
              </Button>
              {project.repo && (
                <a
                  href={project.repo.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  GitHub
                </a>
              )}
            </div>
          </Card>
        );
      })}

      {onCancel && (
        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
};

export default FactoryProjectPicker;

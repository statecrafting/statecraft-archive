// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 112 §7 — OPC's "Projects" panel.
//
// Listens for `project.catalog.upsert` envelopes over the duplex sync
// channel and maintains a workspace-scoped list of projects. Opening a
// row clones the repo locally if not yet present and activates the
// Factory Cockpit (§4) — handled by the surrounding route.

import React, { useCallback, useMemo } from 'react';
import { Folder, ExternalLink } from 'lucide-react';
import { Badge } from '@opc/ui/badge';
import { Button } from '@opc/ui/button';
import { Card } from '@opc/ui/card';

export interface ProjectCatalogEntry {
  projectId: string;
  orgId: string;
  name: string;
  slug: string;
  description: string;
  factoryAdapterId: string | null;
  detectionLevel:
    | 'not_factory'
    | 'scaffold_only'
    | 'legacy_produced'
    | 'acp_produced'
    | null;
  repo: {
    githubOrg: string;
    repoName: string;
    defaultBranch: string;
    cloneUrl: string;
    htmlUrl: string;
  } | null;
  opcDeepLink: string;
  updatedAt: string;
  /** Caller-managed: set when the repo is cloned locally. */
  localPath?: string;
}

export interface ProjectsPanelProps {
  projects: ProjectCatalogEntry[];
  onOpen: (project: ProjectCatalogEntry) => void;
  onClone?: (project: ProjectCatalogEntry) => void;
}

const LEVEL_LABEL: Record<Exclude<ProjectCatalogEntry['detectionLevel'], null>, string> = {
  not_factory: 'Not factory',
  scaffold_only: 'Scaffold only',
  legacy_produced: 'Legacy',
  acp_produced: 'ACP',
};

export const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
  projects,
  onOpen,
  onClone,
}) => {
  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      ),
    [projects]
  );

  const handleOpen = useCallback(
    (project: ProjectCatalogEntry) => {
      if (!project.localPath && onClone) {
        onClone(project);
        return;
      }
      onOpen(project);
    },
    [onOpen, onClone]
  );

  return (
    <div className="h-full flex flex-col text-foreground">
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
        <Folder className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold flex-1">Projects</h1>
        <span className="text-xs text-muted-foreground">{sorted.length}</span>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sorted.length === 0 && (
          <Card className="p-4 text-sm text-muted-foreground">
            No projects yet. Create or import one in statecraft — connected
            desktops pick up the catalog over the sync channel.
          </Card>
        )}
        {sorted.map((project) => (
          <Card key={project.projectId} className="p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium flex-1 truncate">
                {project.name}
              </span>
              {project.detectionLevel && project.detectionLevel !== 'not_factory' && (
                <Badge variant="secondary" className="text-xs">
                  {LEVEL_LABEL[project.detectionLevel]}
                </Badge>
              )}
              {project.localPath ? (
                <Badge variant="outline" className="text-xs">local</Badge>
              ) : (
                <Badge variant="outline" className="text-xs">remote</Badge>
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
                onClick={() => handleOpen(project)}
              >
                {project.localPath ? 'Open' : 'Clone & open'}
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
        ))}
      </div>
    </div>
  );
};

export default ProjectsPanel;

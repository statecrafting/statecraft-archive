// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 112 §4 — Factory Project Cockpit.
//
// Renders detection output for an opened folder and offers the four
// cockpit actions (Run Stage N, Reconcile, Re-extract, Register with
// workspace). Action handlers are slotted: the Register action dispatches
// through the existing sync client, and the run-stage actions delegate to
// the FactoryPipelinePanel which already speaks the spec 110 envelope.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, RefreshCw, Workflow, Link2, AlertCircle } from 'lucide-react';
import { apiCall } from '@/lib/apiAdapter';
import { Badge } from '@opc/ui/badge';
import { Button } from '@opc/ui/button';
import { Card } from '@opc/ui/card';
import { cn } from '@/lib/utils';

// ── Wire types (mirror factory-project-detect serde output) ──────────────

export type DetectionLevel =
  | 'not_factory'
  | 'scaffold_only'
  | 'legacy_produced'
  | 'acp_produced';

interface AdapterRef {
  name: string;
  version: string;
}

interface StageArtifact {
  path: string;
  type?: string;
  hash?: string;
}

interface StageEntry {
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  started_at?: string;
  completed_at?: string;
  artifacts?: StageArtifact[];
}

interface PipelineIdentity {
  id: string;
  factory_version: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  adapter: AdapterRef;
  build_spec: { path: string; hash: string };
}

interface PipelineStateWire {
  schema_version: string;
  pipeline: PipelineIdentity;
  stages: Record<string, StageEntry>;
}

export interface FactoryProject {
  level: DetectionLevel;
  pipeline_state?: PipelineStateWire;
  adapter_ref?: AdapterRef;
  legacy_manifest?: unknown;
  legacy_complete?: boolean;
  legacy_incomplete_stages?: string[];
}

interface DetectResponse {
  ok: boolean;
  project?: FactoryProject;
  error?: string;
}

// ── Canonical ACP stage ordering ─────────────────────────────────────────

const STAGE_ORDER = [
  'pre-flight',
  'business-requirements',
  'service-requirements',
  'data-model',
  'api-specification',
  'ui-specification',
  'adapter-handoff',
] as const;

const STATUS_VARIANT: Record<
  StageEntry['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  pending: 'outline',
  in_progress: 'default',
  completed: 'secondary',
  failed: 'destructive',
  skipped: 'outline',
};

const LEVEL_LABEL: Record<DetectionLevel, string> = {
  not_factory: 'Not a factory project',
  scaffold_only: 'Scaffold only',
  legacy_produced: 'Legacy produced',
  acp_produced: 'ACP produced',
};

// ── Component ────────────────────────────────────────────────────────────

export interface ProjectCockpitProps {
  projectPath: string;
  /** Slot for an external Run Stage N dispatcher (spec 110 envelope). */
  onRunStage?: (stageId: string) => void;
  /** Slot for Reconcile (spec 088-style drift reconciliation). */
  onReconcile?: () => void;
  /** Slot for Re-extract against local .artifacts/raw/. */
  onReExtract?: () => void;
  /** Slot for the workspace Register action (spec 108). */
  onRegisterWithWorkspace?: () => void;
}

export const ProjectCockpit: React.FC<ProjectCockpitProps> = ({
  projectPath,
  onRunStage,
  onReconcile,
  onReExtract,
  onRegisterWithWorkspace,
}) => {
  const [state, setState] = useState<DetectResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiCall<DetectResponse>('detect_factory_project', {
        request: { path: projectPath },
      });
      setState(response);
      if (!response.ok && response.error) {
        setError(response.error);
      }
    } catch (err) {
      console.error('detect_factory_project failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const project = state?.project;
  const level: DetectionLevel = project?.level ?? 'not_factory';
  const isFactory = level !== 'not_factory';

  const stages = useMemo(() => {
    if (!project?.pipeline_state?.stages) return [] as Array<[string, StageEntry]>;
    const defined = project.pipeline_state.stages;
    return STAGE_ORDER.filter((id) => defined[id]).map(
      (id) => [id, defined[id]] as [string, StageEntry]
    );
  }, [project]);

  return (
    <div className="h-full flex flex-col text-foreground">
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
        <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
        <h1 className="text-sm font-semibold flex-1">Factory Cockpit</h1>
        <Badge variant={isFactory ? 'default' : 'outline'}>{LEVEL_LABEL[level]}</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Re-run detection"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <Card className="p-3 border-destructive/40 bg-destructive/5 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-xs text-destructive">{error}</div>
          </Card>
        )}

        {!isFactory && !error && (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              This directory is not a factory project. Open one created or
              imported through statecraft to see the cockpit.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono truncate">
              {projectPath}
            </p>
          </Card>
        )}

        {isFactory && project && (
          <>
            <IdentitySection project={project} />
            {stages.length > 0 ? (
              <StageTimeline stages={stages} isLegacy={level === 'legacy_produced'} />
            ) : (
              <ScaffoldOnlyHint />
            )}
            <Actions
              level={level}
              stages={stages.map(([id]) => id)}
              onRunStage={onRunStage}
              onReconcile={onReconcile}
              onReExtract={onReExtract}
              onRegisterWithWorkspace={onRegisterWithWorkspace}
            />
            {level === 'legacy_produced' && project.legacy_complete === false && (
              <LegacyIncompleteNotice
                stages={project.legacy_incomplete_stages ?? []}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Sub-components ───────────────────────────────────────────────────────

const IdentitySection: React.FC<{ project: FactoryProject }> = ({ project }) => {
  const adapter = project.adapter_ref;
  const pipeline = project.pipeline_state?.pipeline;
  return (
    <Card className="p-3 space-y-1.5">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">Adapter</div>
      {adapter ? (
        <div className="text-sm font-mono">
          {adapter.name} <span className="text-muted-foreground">@ {adapter.version}</span>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No adapter reference detected</div>
      )}
      {pipeline && (
        <div className="pt-2 border-t border-border/50 mt-2 space-y-0.5">
          <div className="text-xs text-muted-foreground">
            Pipeline <span className="font-mono">{pipeline.id.slice(0, 8)}…</span>
          </div>
          <div className="text-xs">
            Status <Badge variant="outline">{pipeline.status}</Badge>
          </div>
        </div>
      )}
    </Card>
  );
};

const StageTimeline: React.FC<{
  stages: Array<[string, StageEntry]>;
  isLegacy: boolean;
}> = ({ stages, isLegacy }) => {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-3 py-2 text-xs font-medium border-b border-border bg-muted/30 flex items-center gap-2">
        <Workflow className="h-3.5 w-3.5" />
        Stage timeline
      </div>
      <ul className="divide-y divide-border">
        {stages.map(([id, entry]) => {
          const synthesised = isLegacy && (id === 'pre-flight' || id === 'adapter-handoff');
          return (
            <li key={id} className="px-3 py-2 flex items-center gap-3">
              <Badge variant={STATUS_VARIANT[entry.status]} className="shrink-0">
                {entry.status}
              </Badge>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono truncate">{id}</div>
                {entry.completed_at && (
                  <div className="text-xs text-muted-foreground">
                    completed {entry.completed_at}
                  </div>
                )}
              </div>
              {isLegacy && (
                <Badge variant="outline" className="text-xs">
                  {synthesised ? 'synthesised' : 'legacy'}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground shrink-0">
                {entry.artifacts?.length ?? 0} artefacts
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

const ScaffoldOnlyHint: React.FC = () => (
  <Card className="p-3 text-sm text-muted-foreground">
    Pipeline not yet started. Run Stage 1 (pre-flight) to begin producing
    requirements and code for this scaffold.
  </Card>
);

const Actions: React.FC<{
  level: DetectionLevel;
  stages: string[];
  onRunStage?: (stageId: string) => void;
  onReconcile?: () => void;
  onReExtract?: () => void;
  onRegisterWithWorkspace?: () => void;
}> = ({ level, stages, onRunStage, onReconcile, onReExtract, onRegisterWithWorkspace }) => {
  // Pick the first non-completed stage as the default Run target.
  const nextStage = stages.find(Boolean) ?? 'pre-flight';
  return (
    <Card className="p-3 flex flex-wrap gap-2">
      <Button
        size="sm"
        onClick={() => onRunStage?.(nextStage)}
        disabled={!onRunStage}
        title={onRunStage ? undefined : 'Run dispatch not wired in this context'}
      >
        Run Stage ({nextStage})
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onReconcile}
        disabled={!onReconcile || level === 'scaffold_only'}
      >
        Reconcile
      </Button>
      <Button size="sm" variant="outline" onClick={onReExtract} disabled={!onReExtract}>
        Re-extract
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onRegisterWithWorkspace}
        disabled={!onRegisterWithWorkspace}
      >
        <Link2 className="h-3.5 w-3.5 mr-1.5" />
        Register with workspace
      </Button>
    </Card>
  );
};

const LegacyIncompleteNotice: React.FC<{ stages: string[] }> = ({ stages }) => (
  <Card className="p-3 border-amber-500/40 bg-amber-500/5 text-xs space-y-1">
    <div className="font-medium text-amber-600 dark:text-amber-400">
      Legacy pipeline incomplete
    </div>
    <div className="text-muted-foreground">
      Finish the upstream `legacy-factory` run before importing this
      project into statecraft. Incomplete stages:
    </div>
    <ul className="list-disc pl-5 font-mono">
      {stages.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  </Card>
);

export default ProjectCockpit;

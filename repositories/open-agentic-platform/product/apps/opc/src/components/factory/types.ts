// Spec: specs/076-factory-desktop-panel/spec.md
// TypeScript types for the Factory Pipeline panel.

/** Pipeline execution phase.
 *
 * `paused` means the run was hydrated from disk and is not actively
 * running. It enables Resume in place of Cancel and suppresses the live
 * output panel. The backend uses it for runs loaded from `state.json` /
 * manifest-only directories that aren't in `FACTORY_RUNS`.
 */
export type FactoryPhase =
  | 'idle'
  | 'process'
  | 'scaffolding'
  | 'complete'
  | 'failed'
  | 'paused';

/** Visual status for a stage or step node. */
export type StageStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'awaiting_gate' | 'skipped';

/** Process stage definition (s0–s5). */
export interface ProcessStage {
  id: string;
  name: string;
  index: number;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  tokenSpend: number;
  artifacts: string[];
}

/** Scaffold category grouping. */
export type ScaffoldCategory = 'data' | 'api' | 'ui' | 'configure' | 'trim' | 'validate';

/** Individual scaffold step. */
export interface ScaffoldStep {
  id: string;
  category: ScaffoldCategory;
  featureName: string;
  status: StageStatus;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  tokenSpend: number;
}

/** Category-level progress. */
export interface ScaffoldCategoryProgress {
  category: ScaffoldCategory;
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  steps: ScaffoldStep[];
}

/** Full scaffolding state. */
export interface ScaffoldingState {
  categories: ScaffoldCategoryProgress[];
  activeStepId: string | null;
}

/** Token usage per stage. */
export interface StageTokenSpend {
  stageId: string;
  stageName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Cumulative token tracking. */
export interface TokenSpend {
  stages: StageTokenSpend[];
  totalTokens: number;
  budgetLimit: number | null;
}

/** Gate action — shown when orchestrator emits gate_reached. */
export interface GateAction {
  runId: string;
  stageId: string;
  stageName: string;
  gateType: 'checkpoint' | 'approval';
  summary?: GateSummary;
  /** Milliseconds until this gate times out (approval gates only). */
  timeoutMs?: number;
  /** ISO timestamp when the gate was opened, used with timeoutMs for countdown. */
  openedAt?: string;
}

/** Summary statistics shown in gate dialogs. */
export interface GateSummary {
  entityCount?: number;
  operationCount?: number;
  pageCount?: number;
  ruleCount?: number;
  description?: string;
}

/** Artifact entry for inspector. */
export interface ArtifactEntry {
  name: string;
  path: string;
  size: number;
  mimeType: 'markdown' | 'json' | 'yaml' | 'text' | 'unknown';
}

/** A pipeline run summary surfaced in the history list. */
export interface PipelineRun {
  runId: string;
  /** Adapter recorded in `state.json`, or `null` for legacy manifest-only
   * runs that pre-date early state persistence. The history table renders
   * `null` as `—`; Resume falls back to the bundle adapter. */
  adapter: string | null;
  projectPath: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  phase: FactoryPhase;
  totalTokens: number;
  /** Count of process stages with at least one output artifact on disk. */
  stagesCompleted: number;
  /** Total declared process stages — currently always 6. */
  stagesTotal: number;
  /** Display name of the highest-index completed process stage. */
  lastCompletedStage: string | null;
}

/** Audit trail entry. */
export interface AuditEntry {
  timestamp: string;
  action: 'stage_confirmed' | 'stage_rejected' | 'build_spec_frozen' | 'step_retried' | 'step_skipped' | 'pipeline_started' | 'pipeline_completed' | 'pipeline_failed';
  stageId?: string;
  details?: string;
  feedback?: string;
}

/** Top-level pipeline state managed by FactoryPipelineContext. */
export interface FactoryPipelineState {
  runId: string | null;
  phase: FactoryPhase;
  stages: ProcessStage[];
  scaffolding: ScaffoldingState | null;
  tokenSpend: TokenSpend;
  selectedStepId: string | null;
  artifacts: Map<string, ArtifactEntry[]>;
  gateAction: GateAction | null;
  auditTrail: AuditEntry[];
  /** Project filesystem path tied to this run. Set by `loadPipelineStatus`
   * for disk-loaded runs and used by Resume / artifact lookups so they work
   * after the run has fallen out of `FACTORY_RUNS`. */
  projectPath: string | null;
  /** Adapter recorded in the run's `state.json`. Empty for legacy runs that
   * predate the early state-write — Resume falls back to the bundle adapter
   * when present. */
  adapter: string | null;
}

// ── Tauri event payloads ─────────────────────────────────────────────

export interface FactoryStepStartedEvent {
  runId: string;
  stepId: string;
  stepName: string;
}

export interface FactoryStepCompletedEvent {
  runId: string;
  stepId: string;
  artifacts: string[];
  tokenSpend: number;
}

export interface FactoryStepFailedEvent {
  runId: string;
  stepId: string;
  error: string;
  retryCount: number;
}

export interface FactoryGateReachedEvent {
  runId: string;
  stageId: string;
  stageName: string;
  gateType: 'checkpoint' | 'approval';
  summary?: GateSummary;
  /** Milliseconds until this gate times out (approval gates only). */
  timeoutMs?: number;
}

export interface FactoryScaffoldProgressEvent {
  runId: string;
  category: ScaffoldCategory;
  stepId: string;
  featureName: string;
  status: 'started' | 'completed' | 'failed';
  error?: string;
  retryCount?: number;
}

export interface FactoryTokenUpdateEvent {
  runId: string;
  stageId: string;
  promptTokens: number;
  completionTokens: number;
}

export interface FactoryAgentOutputEvent {
  runId: string;
  stepId: string;
  line: string;
}

/** A single line of streamed agent output. */
export interface AgentOutputLine {
  stepId: string;
  line: string;
  timestamp: string;
}

// ── Process stage constants ──────────────────────────────────────────

// Canonical six-stage pipeline. Post spec 076 this is the FALLBACK + the
// display-label source: a live run derives its stage list from the platform
// process definition (`stagesFromProcessDefinition`), and falls back to these
// when no definition is available. Stage ids are load-bearing — events
// `factory:step_started` / `step_completed` / `gate_reached` arrive with these
// full ids; if they drift the DAG never advances out of `pending`. The ids
// here match the platform definition because both derive from the same factory
// template, so the fallback stays consistent with a server-derived list.
export const PROCESS_STAGES: { id: string; name: string }[] = [
  { id: 's0-preflight', name: 'Pre-flight' },
  { id: 's1-business-requirements', name: 'Business Requirements' },
  { id: 's2-service-requirements', name: 'Service Requirements' },
  { id: 's3-data-model', name: 'Data Model' },
  { id: 's4-api-specification', name: 'API Specification' },
  { id: 's5-ui-specification', name: 'UI Specification' },
];

/** Curated display labels for the canonical stage ids, used to label
 *  server-derived stages; unknown ids fall back to a titleised id. */
const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  PROCESS_STAGES.map((s) => [s.id, s.name]),
);

/** Drop a leading `sN-` ordering prefix (when present) and capitalise words
 *  so a platform-defined stage the client hasn't seen still reads cleanly. */
function titleizeStageId(id: string): string {
  const body = /^s\d+-/.test(id) ? id.replace(/^s\d+-/, '') : id;
  return body
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Derive the pipeline stage list from a platform process definition
 * (spec 076) — `definition.stages: [{ id }]`. The id is load-bearing (must
 * match the duplex events / backend); the label uses the curated map,
 * falling back to a titleised id for stages the client hasn't seen. Returns
 * [] when the definition has no recognisable stages, so callers fall back to
 * PROCESS_STAGES rather than rendering an empty DAG.
 */
export function stagesFromProcessDefinition(
  definition: unknown,
): { id: string; name: string }[] {
  const stages = (definition as { stages?: unknown } | null | undefined)?.stages;
  if (!Array.isArray(stages)) return [];
  const out: { id: string; name: string }[] = [];
  for (const s of stages) {
    const id = (s as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id.length > 0) {
      out.push({ id, name: STAGE_LABELS[id] ?? titleizeStageId(id) });
    }
  }
  return out;
}

export const SCAFFOLD_CATEGORY_LABELS: Record<ScaffoldCategory, string> = {
  data: 'Data Entities',
  api: 'API Operations',
  ui: 'UI Pages',
  configure: 'Configure',
  trim: 'Trim',
  validate: 'Final Validation',
};

/**
 * Create initial empty pipeline state. Pass `stages` (e.g. from
 * `stagesFromProcessDefinition(bundle.processes[0].definition)`) to seed the
 * DAG from the platform process definition (spec 076); omit/empty to fall
 * back to the canonical `PROCESS_STAGES` so the DAG is never empty.
 */
export function createInitialPipelineState(
  stages: { id: string; name: string }[] = PROCESS_STAGES,
): FactoryPipelineState {
  const effective = stages.length > 0 ? stages : PROCESS_STAGES;
  return {
    runId: null,
    phase: 'idle',
    stages: effective.map((s, i) => ({
      id: s.id,
      name: s.name,
      index: i,
      status: 'pending',
      tokenSpend: 0,
      artifacts: [],
    })),
    scaffolding: null,
    tokenSpend: { stages: [], totalTokens: 0, budgetLimit: null },
    selectedStepId: null,
    artifacts: new Map(),
    gateAction: null,
    auditTrail: [],
    projectPath: null,
    adapter: null,
  };
}

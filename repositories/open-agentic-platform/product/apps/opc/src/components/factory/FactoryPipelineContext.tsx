// Spec: specs/076-factory-desktop-panel/spec.md
// Extended by spec 171 (agent-plan-rendering aspect) for the
// PlanReviewDialog primary surface: proposedPlan / certificateActual
// state and propose/approve/reject/dismiss actions.

import React, {
  createContext,
  useState,
  useContext,
  useCallback,
  useEffect,
} from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { apiCall } from '@/lib/apiAdapter';
import {
  FactoryPipelineState,
  ArtifactEntry,
  GateAction,
  AuditEntry,
  AgentOutputLine,
  FactoryStepStartedEvent,
  FactoryStepCompletedEvent,
  FactoryStepFailedEvent,
  FactoryGateReachedEvent,
  FactoryScaffoldProgressEvent,
  FactoryAgentOutputEvent,
  createInitialPipelineState,
} from './types';
import type { AgentPlan, CertificateActual } from './planTypes';
import { hashPlan } from './planTypes';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_AGENT_OUTPUT_LINES = 500;

// ── Context shape ────────────────────────────────────────────────────────────

interface FactoryPipelineContextType {
  state: FactoryPipelineState;
  agentOutput: AgentOutputLine[];
  /** Spec 171: the agent-proposed plan currently awaiting structural-
   *  diff review, or null when no plan is pending. */
  proposedPlan: AgentPlan | null;
  /** Spec 171 FR-006: the actual governance certificate stage list
   *  emitted after the most recent plan executed. Compared against
   *  the prediction inside PlanReviewDialog. */
  certificateActual: CertificateActual | null;
  startPipeline: (
    projectPath: string,
    adapterName: string,
    businessDocPaths: string[],
    statecraftProjectId?: string,
    /** Platform process name from the project bundle. Omitted → the
     *  backend resolves the org's current process from the platform, so
     *  a platform-side rename needs no client change. */
    processName?: string,
    /** Stage list derived from the platform process definition (spec 076).
     *  Omitted/empty → the canonical fallback stages are used. */
    stages?: { id: string; name: string }[],
  ) => Promise<string>;
  confirmStage: (stageId: string) => Promise<void>;
  rejectStage: (stageId: string, feedback: string) => Promise<void>;
  skipStep: (stepId: string) => Promise<void>;
  cancelPipeline: (reason: string) => Promise<void>;
  resumePipeline: (args: {
    adapterName?: string;
    statecraftProjectId?: string;
  }) => Promise<void>;
  selectStep: (stepId: string | null) => void;
  loadPipelineStatus: (runId: string, projectPath?: string) => Promise<void>;
  loadArtifacts: (stepId: string) => Promise<ArtifactEntry[]>;
  dismissGate: () => void;
  // ── Spec 171 — plan review surface ─────────────────────────────────
  /** Surface a new agent-proposed plan. Replaces any pending plan. */
  proposePlan: (plan: AgentPlan) => void;
  /** Record an approved plan. The cockpit forwards the plan id + hash
   *  to the audit trail; the actual dispatch is the caller's job. */
  approvePlan: (planId: string, planHash: string) => void;
  /** Record a rejected plan with the reason supplied by the human. */
  rejectPlan: (planId: string, reason: string) => void;
  /** Dismiss the plan-review dialog without recording an action. */
  dismissPlan: () => void;
}

// ── Context creation ─────────────────────────────────────────────────────────

const FactoryPipelineContext = createContext<
  FactoryPipelineContextType | undefined
>(undefined);

// ── Helper ───────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

// ── Provider ─────────────────────────────────────────────────────────────────

export const FactoryPipelineProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [state, setState] = useState<FactoryPipelineState>(
    createInitialPipelineState,
  );
  const [agentOutput, setAgentOutput] = useState<AgentOutputLine[]>([]);
  // Spec 171 plan-review state — kept outside FactoryPipelineState
  // so the existing pipeline schema (owned by spec 076) stays
  // untouched and the spec-code coupling gate sees the new state
  // surface in the same module that registers the new tauri event.
  const [proposedPlan, setProposedPlan] = useState<AgentPlan | null>(null);
  const [certificateActual, setCertificateActual] =
    useState<CertificateActual | null>(null);

  // ── Tauri event listeners ──────────────────────────────────────────────────

  useEffect(() => {
    // StrictMode (and HMR) re-runs effects: the cleanup fires before
    // `setupListeners` finishes its first awaited `listen()`, so the
    // unlisteners array is still empty when cleanup reads it. Without
    // a cancelled flag we leak listeners across reruns and end up with
    // two callbacks per event — visible as doubled lines in the live
    // output. The flag lets each awaited registration unsubscribe
    // itself if the effect already cleaned up.
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const track = (un: UnlistenFn) => {
      if (cancelled) {
        un();
      } else {
        unlisteners.push(un);
      }
    };

    async function setupListeners() {
      // factory:step_started
      track(
        await listen<FactoryStepStartedEvent>('factory:step_started', (event) => {
          const { stepId } = event.payload;
          // Clear output when a new step starts
          setAgentOutput([]);
          setState((prev) => ({
            ...prev,
            stages: prev.stages.map((s) =>
              s.id === stepId
                ? { ...s, status: 'in_progress', startedAt: nowIso() }
                : s,
            ),
          }));
        }),
      );

      // factory:step_completed
      track(
        await listen<FactoryStepCompletedEvent>(
          'factory:step_completed',
          (event) => {
            const { stepId, artifacts, tokenSpend } = event.payload;
            setState((prev) => {
              const stageEntry = prev.stages.find((s) => s.id === stepId);
              const stageName = stageEntry?.name ?? stepId;
              const existingTokenStage = prev.tokenSpend.stages.find(
                (s) => s.stageId === stepId,
              );
              const updatedTokenStages = existingTokenStage
                ? prev.tokenSpend.stages.map((s) =>
                    s.stageId === stepId
                      ? {
                          ...s,
                          completionTokens: s.completionTokens + tokenSpend,
                          totalTokens: s.totalTokens + tokenSpend,
                        }
                      : s,
                  )
                : [
                    ...prev.tokenSpend.stages,
                    {
                      stageId: stepId,
                      stageName,
                      promptTokens: 0,
                      completionTokens: tokenSpend,
                      totalTokens: tokenSpend,
                    },
                  ];
              return {
                ...prev,
                stages: prev.stages.map((s) =>
                  s.id === stepId
                    ? {
                        ...s,
                        status: 'completed',
                        completedAt: nowIso(),
                        artifacts,
                        tokenSpend: s.tokenSpend + tokenSpend,
                      }
                    : s,
                ),
                tokenSpend: {
                  ...prev.tokenSpend,
                  stages: updatedTokenStages,
                  totalTokens: prev.tokenSpend.totalTokens + tokenSpend,
                },
              };
            });
          },
        ),
      );

      // factory:step_failed
      track(
        await listen<FactoryStepFailedEvent>('factory:step_failed', (event) => {
          const { stepId } = event.payload;
          setState((prev) => ({
            ...prev,
            stages: prev.stages.map((s) =>
              s.id === stepId ? { ...s, status: 'failed' } : s,
            ),
          }));
        }),
      );

      // factory:gate_reached
      track(
        await listen<FactoryGateReachedEvent>(
          'factory:gate_reached',
          (event) => {
            const { runId, stageId, stageName, gateType, summary, timeoutMs } =
              event.payload;
            const gateAction: GateAction = {
              runId,
              stageId,
              stageName,
              gateType,
              summary,
              timeoutMs,
              openedAt: new Date().toISOString(),
            };
            setState((prev) => ({
              ...prev,
              stages: prev.stages.map((s) =>
                s.id === stageId ? { ...s, status: 'awaiting_gate' } : s,
              ),
              gateAction,
            }));
          },
        ),
      );

      // factory:scaffold_progress
      track(
        await listen<FactoryScaffoldProgressEvent>(
          'factory:scaffold_progress',
          (event) => {
            const {
              category,
              stepId,
              featureName,
              status,
              error,
              retryCount,
            } = event.payload;

            // Clear output when a new scaffold step starts
            if (status === 'started') {
              setAgentOutput([]);
            }

            setState((prev) => {
              if (!prev.scaffolding) return prev;

              const updatedCategories = prev.scaffolding.categories.map(
                (cat) => {
                  if (cat.category !== category) return cat;

                  const existingStep = cat.steps.find((s) => s.id === stepId);

                  let updatedSteps;
                  if (existingStep) {
                    updatedSteps = cat.steps.map((s) =>
                      s.id === stepId
                        ? {
                            ...s,
                            status:
                              status === 'started'
                                ? ('in_progress' as const)
                                : status === 'completed'
                                  ? ('completed' as const)
                                  : ('failed' as const),
                            lastError: error,
                            retryCount: retryCount ?? s.retryCount,
                          }
                        : s,
                    );
                  } else {
                    updatedSteps = [
                      ...cat.steps,
                      {
                        id: stepId,
                        category,
                        featureName,
                        status:
                          status === 'started'
                            ? ('in_progress' as const)
                            : status === 'completed'
                              ? ('completed' as const)
                              : ('failed' as const),
                        retryCount: retryCount ?? 0,
                        maxRetries: 3,
                        lastError: error,
                        tokenSpend: 0,
                      },
                    ];
                  }

                  const completed = updatedSteps.filter(
                    (s) => s.status === 'completed',
                  ).length;
                  const failed = updatedSteps.filter(
                    (s) => s.status === 'failed',
                  ).length;
                  const inProgress = updatedSteps.filter(
                    (s) => s.status === 'in_progress',
                  ).length;

                  return {
                    ...cat,
                    steps: updatedSteps,
                    total: updatedSteps.length,
                    completed,
                    failed,
                    inProgress,
                  };
                },
              );

              return {
                ...prev,
                scaffolding: {
                  ...prev.scaffolding,
                  categories: updatedCategories,
                  activeStepId:
                    status === 'started' ? stepId : prev.scaffolding.activeStepId,
                },
              };
            });
          },
        ),
      );

      // factory:token_update
      track(
        await listen<{ runId: string; stageId: string; promptTokens: number; completionTokens: number }>(
          'factory:token_update',
          (event) => {
            const { stageId, promptTokens, completionTokens } = event.payload;
            const totalTokens = promptTokens + completionTokens;

            setState((prev) => {
              const existingStageEntry = prev.tokenSpend.stages.find(
                (s) => s.stageId === stageId,
              );
              const stageName =
                prev.stages.find((s) => s.id === stageId)?.name ?? stageId;

              const updatedStages = existingStageEntry
                ? prev.tokenSpend.stages.map((s) =>
                    s.stageId === stageId
                      ? {
                          ...s,
                          promptTokens: s.promptTokens + promptTokens,
                          completionTokens:
                            s.completionTokens + completionTokens,
                          totalTokens: s.totalTokens + totalTokens,
                        }
                      : s,
                  )
                : [
                    ...prev.tokenSpend.stages,
                    {
                      stageId,
                      stageName,
                      promptTokens,
                      completionTokens,
                      totalTokens,
                    },
                  ];

              const newTotal = updatedStages.reduce(
                (sum, s) => sum + s.totalTokens,
                0,
              );

              return {
                ...prev,
                tokenSpend: {
                  ...prev.tokenSpend,
                  stages: updatedStages,
                  totalTokens: newTotal,
                },
              };
            });
          },
        ),
      );

      // factory:agent_output — stream lines into agentOutput state
      track(
        await listen<FactoryAgentOutputEvent>('factory:agent_output', (event) => {
          const { stepId, line } = event.payload;
          const entry: AgentOutputLine = {
            stepId,
            line,
            timestamp: nowIso(),
          };
          setAgentOutput((prev) => {
            const next = [...prev, entry];
            // Keep last MAX_AGENT_OUTPUT_LINES lines to avoid memory growth
            return next.length > MAX_AGENT_OUTPUT_LINES
              ? next.slice(next.length - MAX_AGENT_OUTPUT_LINES)
              : next;
          });
        }),
      );

      // factory:workflow_started — FR-009: initialize DAG display
      track(
        await listen<{ runId: string }>('factory:workflow_started', (event) => {
          const { runId } = event.payload;
          setAgentOutput([]);
          setState((prev) => ({
            ...createInitialPipelineState(),
            runId,
            phase: 'process',
            artifacts: prev.artifacts,
          }));
        }),
      );

      // factory:workflow_failed — flip to 'failed' so the badge stops
      // claiming the run is still processing, mark any stage that was
      // in flight as failed, and record the error in the audit trail.
      track(
        await listen<{ runId: string; error?: string; phase?: string }>(
          'factory:workflow_failed',
          (event) => {
            const { error, phase } = event.payload;
            setState((prev) => ({
              ...prev,
              phase: 'failed',
              gateAction: null,
              stages: prev.stages.map((s) =>
                s.status === 'in_progress' ? { ...s, status: 'failed' } : s,
              ),
              auditTrail: [
                ...prev.auditTrail,
                {
                  timestamp: nowIso(),
                  action: 'pipeline_failed',
                  details: error
                    ? `${phase ?? 'pipeline'}: ${error}`
                    : phase ?? undefined,
                },
              ],
            }));
          },
        ),
      );

      // factory:workflow_completed — terminal success.
      track(
        await listen<{ runId: string; totalSteps?: number; totalTokens?: number }>(
          'factory:workflow_completed',
          (_event) => {
            setState((prev) => ({
              ...prev,
              phase: 'complete',
              gateAction: null,
              auditTrail: [
                ...prev.auditTrail,
                { timestamp: nowIso(), action: 'pipeline_completed' },
              ],
            }));
          },
        ),
      );

      // factory:plan_proposed — spec 171. An agent surfaces a plan for
      // structural-diff review. The payload IS the AgentPlan shape;
      // PlanReviewDialog enriches and hashes it.
      track(
        await listen<AgentPlan>('factory:plan_proposed', (event) => {
          setProposedPlan(event.payload);
          // A new plan supersedes any leftover certificate-actual
          // diff from the previous plan.
          setCertificateActual(null);
        }),
      );

      // factory:certificate_emitted — spec 171 FR-006. The actual
      // governance-certificate stage list emitted by spec 102's
      // pipeline; compared against the proposed plan's prediction.
      track(
        await listen<CertificateActual>(
          'factory:certificate_emitted',
          (event) => {
            setCertificateActual(event.payload);
          },
        ),
      );

      // factory:workflow_cancelled — backend confirms cancel; mirror to
      // 'failed' (no separate cancelled phase) and clear any open gate.
      track(
        await listen<{ runId: string; reason?: string }>(
          'factory:workflow_cancelled',
          (event) => {
            const { reason } = event.payload;
            setState((prev) => ({
              ...prev,
              phase: 'failed',
              gateAction: null,
              stages: prev.stages.map((s) =>
                s.status === 'in_progress' ? { ...s, status: 'failed' } : s,
              ),
              auditTrail: [
                ...prev.auditTrail,
                {
                  timestamp: nowIso(),
                  action: 'pipeline_failed',
                  details: reason ? `cancelled: ${reason}` : 'cancelled',
                },
              ],
            }));
          },
        ),
      );
    }

    setupListeners().catch((err) => {
      console.error('[FactoryPipelineContext] Failed to set up event listeners:', err);
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const startPipeline = useCallback(
    async (
      projectPath: string,
      adapterName: string,
      businessDocPaths: string[],
      statecraftProjectId?: string,
      processName?: string,
      stages?: { id: string; name: string }[],
    ): Promise<string> => {
      const resp = await apiCall<{ run_id: string }>('start_factory_pipeline', {
        projectPath,
        adapterName,
        businessDocPaths,
        statecraftProjectId,
        processName,
      });
      const runId = resp.run_id;

      setAgentOutput([]);
      setState((_prev) => {
        const auditEntry: AuditEntry = {
          timestamp: nowIso(),
          action: 'pipeline_started',
          details: `adapter=${adapterName} project=${projectPath}`,
        };
        return {
          // Seed the DAG from the platform-derived stage list (spec 076);
          // createInitialPipelineState falls back to the canonical stages
          // when `stages` is undefined/empty.
          ...createInitialPipelineState(stages),
          runId,
          phase: 'process',
          auditTrail: [auditEntry],
          projectPath,
          adapter: adapterName,
        };
      });

      return runId;
    },
    [],
  );

  const confirmStage = useCallback(
    async (stageId: string): Promise<void> => {
      const runId = state.runId;
      if (!runId) return;

      await apiCall<void>('confirm_factory_stage', { runId, stageId });

      setState((prev) => {
        const auditEntry: AuditEntry = {
          timestamp: nowIso(),
          action: 'stage_confirmed',
          stageId,
        };
        return {
          ...prev,
          gateAction: null,
          auditTrail: [...prev.auditTrail, auditEntry],
        };
      });
    },
    [state.runId],
  );

  const rejectStage = useCallback(
    async (stageId: string, feedback: string): Promise<void> => {
      const runId = state.runId;
      if (!runId) return;

      await apiCall<void>('reject_factory_stage', { runId, stageId, feedback });

      setState((prev) => {
        const auditEntry: AuditEntry = {
          timestamp: nowIso(),
          action: 'stage_rejected',
          stageId,
          feedback,
        };
        return {
          ...prev,
          gateAction: null,
          auditTrail: [...prev.auditTrail, auditEntry],
        };
      });
    },
    [state.runId],
  );

  const skipStep = useCallback(
    async (stepId: string): Promise<void> => {
      const runId = state.runId;
      if (!runId) return;

      await apiCall<void>('skip_factory_step', { runId, stepId });
    },
    [state.runId],
  );

  const cancelPipeline = useCallback(
    async (reason: string): Promise<void> => {
      const runId = state.runId;
      if (!runId) return;

      await apiCall<void>('cancel_factory_pipeline', { runId, reason });
      setState((prev) => ({ ...prev, phase: 'failed' }));
    },
    [state.runId],
  );

  const selectStep = useCallback((stepId: string | null): void => {
    setState((prev) => ({ ...prev, selectedStepId: stepId }));
  }, []);

  const loadPipelineStatus = useCallback(
    async (runId: string, projectPath?: string): Promise<void> => {
      // Tauri command returns snake_case fields; map to our camelCase state.
      // `projectPath` lets the backend reconstruct the response from disk
      // when the run is no longer in the in-memory FACTORY_RUNS map (after
      // OPC restart, or when selecting a historical run).
      const resp = await apiCall<any>('get_factory_pipeline_status', {
        runId,
        projectPath,
      });
      // Reset agent output — a hydrated paused run has no live stream.
      setAgentOutput([]);
      setState((prev) => ({
        ...createInitialPipelineState(),
        runId: resp.run_id ?? runId,
        phase: resp.phase ?? prev.phase,
        stages: (resp.stages ?? []).map((s: any, idx: number) => ({
          id: s.id,
          name: s.name,
          index: prev.stages.find((ps) => ps.id === s.id)?.index ?? idx,
          status: s.status,
          startedAt: s.started_at,
          completedAt: s.completed_at,
          tokenSpend: s.token_spend ?? 0,
          artifacts: s.artifacts ?? [],
        })),
        tokenSpend: {
          stages: [],
          totalTokens: resp.total_tokens ?? 0,
          budgetLimit: null,
        },
        auditTrail: (resp.audit_trail ?? []).map((a: any) => ({
          timestamp: a.timestamp,
          action: a.action,
          stageId: a.stage_id,
          details: a.details,
          feedback: a.feedback,
        })),
        projectPath: projectPath ?? prev.projectPath ?? null,
        adapter: resp.adapter ?? prev.adapter ?? null,
      }));
    },
    [],
  );

  const loadArtifacts = useCallback(
    async (stepId: string): Promise<ArtifactEntry[]> => {
      const runId = state.runId;
      if (!runId) return [];

      // Pass the projectPath captured at start/load time so the backend can
      // resolve `<projectPath>/.factory/runs/<runId>/<stepId>/` for runs that
      // are no longer in `FACTORY_RUNS`. Without this the backend falls back
      // to the (empty) `~/.oap/artifacts/<runId>/<stepId>` cache and the
      // inspector renders "No artifacts for this stage".
      const entries = await apiCall<ArtifactEntry[]>('get_factory_artifacts', {
        runId,
        stepId,
        projectPath: state.projectPath ?? undefined,
      });

      setState((prev) => {
        const updated = new Map(prev.artifacts);
        updated.set(stepId, entries);
        return { ...prev, artifacts: updated };
      });

      return entries;
    },
    [state.runId, state.projectPath],
  );

  const resumePipeline = useCallback(
    async (args: {
      adapterName?: string;
      statecraftProjectId?: string;
    }): Promise<void> => {
      const runId = state.runId;
      const projectPath = state.projectPath;
      const adapterName = args.adapterName ?? state.adapter ?? '';
      if (!runId || !projectPath || !adapterName) {
        throw new Error(
          'Resume requires runId, projectPath, and adapterName — supply an adapter via the project bundle or run state.',
        );
      }
      await apiCall<void>('resume_factory_pipeline', {
        runId,
        projectPath,
        adapterName,
        statecraftProjectId: args.statecraftProjectId ?? null,
      });
      // Flip immediately so the UI stops showing Resume while the dispatch
      // task spins up. The first `factory:step_started` event will refine
      // the per-stage status; until then, the run is marked active.
      setState((prev) => ({ ...prev, phase: 'process' }));
    },
    [state.runId, state.projectPath, state.adapter],
  );

  const dismissGate = useCallback((): void => {
    setState((prev) => ({ ...prev, gateAction: null }));
  }, []);

  // ── Spec 171 — plan review actions ─────────────────────────────────

  const proposePlan = useCallback((plan: AgentPlan): void => {
    setProposedPlan(plan);
    setCertificateActual(null);
  }, []);

  const approvePlan = useCallback(
    (planId: string, planHash: string): void => {
      setState((prev) => ({
        ...prev,
        auditTrail: [
          ...prev.auditTrail,
          {
            timestamp: nowIso(),
            action: 'stage_confirmed',
            stageId: planId,
            details: `plan approved hash=${planHash}`,
          },
        ],
      }));
      setProposedPlan(null);
    },
    [],
  );

  const rejectPlan = useCallback(
    (planId: string, reason: string): void => {
      setState((prev) => ({
        ...prev,
        auditTrail: [
          ...prev.auditTrail,
          {
            timestamp: nowIso(),
            action: 'stage_rejected',
            stageId: planId,
            feedback: reason,
            details: 'plan rejected',
          },
        ],
      }));
      setProposedPlan(null);
    },
    [],
  );

  const dismissPlan = useCallback((): void => {
    setProposedPlan(null);
  }, []);

  // Compile-time reference so the unused-import lint stays happy when
  // the dialog renders the hash itself (PlanReviewDialog re-hashes
  // internally for FR-008 stability). The reference also documents
  // that the cockpit *can* compute the canonical hash before approve.
  void hashPlan;

  // ── Context value ──────────────────────────────────────────────────────────

  const value: FactoryPipelineContextType = {
    state,
    agentOutput,
    proposedPlan,
    certificateActual,
    startPipeline,
    confirmStage,
    rejectStage,
    skipStep,
    cancelPipeline,
    resumePipeline,
    selectStep,
    loadPipelineStatus,
    loadArtifacts,
    dismissGate,
    proposePlan,
    approvePlan,
    rejectPlan,
    dismissPlan,
  };

  return (
    <FactoryPipelineContext.Provider value={value}>
      {children}
    </FactoryPipelineContext.Provider>
  );
};

// ── Custom hook ───────────────────────────────────────────────────────────────

export const useFactoryPipeline = (): FactoryPipelineContextType => {
  const context = useContext(FactoryPipelineContext);
  if (!context) {
    throw new Error(
      'useFactoryPipeline must be used within an FactoryPipelineProvider',
    );
  }
  return context;
};

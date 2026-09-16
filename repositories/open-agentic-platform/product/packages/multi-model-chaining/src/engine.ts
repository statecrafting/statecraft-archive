import type { AgentEvent, TokenUsage } from "@opc/provider-registry";
import type {
  ModelChain,
  ChainPhase,
  ChainProvider,
  ChainExecuteOptions,
  ChainEvent,
  ChainResult,
  PhaseResult,
  PhaseUsage,
  PricingTable,
} from "./types.js";
import { ChainError, ChainAbortError } from "./types.js";
import { buildPhaseMessages } from "./transforms.js";
import { createPhaseUsage, aggregateUsage } from "./usage.js";
import {
  createPhaseStartEvent,
  createPhaseEndEvent,
  createChainCompleteEvent,
  createChainErrorEvent,
  augmentEventWithPhase,
} from "./streaming.js";

export interface ChainEngineOptions {
  provider: ChainProvider;
  pricingTable?: PricingTable;
}

/**
 * ChainEngine executes a ModelChain sequentially, streaming events from each phase,
 * collecting outputs, and aggregating usage (FR-001 through FR-009).
 */
export class ChainEngine {
  private readonly provider: ChainProvider;
  private readonly pricingTable?: PricingTable;

  constructor(options: ChainEngineOptions) {
    this.provider = options.provider;
    this.pricingTable = options.pricingTable;
  }

  /**
   * Execute a chain and return the final result.
   * Use stream() for incremental SSE output.
   */
  async execute(
    chain: ModelChain,
    options: ChainExecuteOptions,
  ): Promise<ChainResult> {
    const events: ChainEvent[] = [];
    for await (const event of this.stream(chain, options)) {
      events.push(event);
    }

    // Extract phase results from collected events
    const phaseResults: PhaseResult[] = [];
    const phaseOutputs = new Map<number, string>();
    const phaseUsages = new Map<number, PhaseUsage>();

    for (const event of events) {
      if (event.type === "chain:phase_end") {
        phaseUsages.set(event.phaseIndex, event.usage);
      }
      if ("phaseIndex" in event && event.type === "text_complete" && "text" in event) {
        phaseOutputs.set(event.phaseIndex as number, event.text as string);
      }
    }

    // Check for abort
    const aborted = events.some(
      (e) => e.type === "chain:error" && (e as { error: string }).error.includes("aborted"),
    );

    for (const phase of chain.phases) {
      const output = phaseOutputs.get(phase.phaseIndex);
      const usage = phaseUsages.get(phase.phaseIndex);
      if (output !== undefined && usage !== undefined) {
        phaseResults.push({ phaseIndex: phase.phaseIndex, output, usage });
      }
    }

    const chainComplete = events.find((e) => e.type === "chain:complete");
    const usage = chainComplete && "usage" in chainComplete
      ? chainComplete.usage
      : aggregateUsage(
          phaseResults.map((r) => r.usage),
          this.pricingTable,
        );

    const lastOutput = phaseResults.length > 0
      ? phaseResults[phaseResults.length - 1].output
      : "";

    return {
      output: lastOutput,
      phases: phaseResults,
      usage,
      aborted,
    };
  }

  /**
   * Stream chain events from all phases (FR-007).
   * Yields ChainEvent instances including phase markers.
   */
  async *stream(
    chain: ModelChain,
    options: ChainExecuteOptions,
  ): AsyncGenerator<ChainEvent> {
    const completedPhases: Array<{ output: string; phase: ChainPhase }> = [];
    const phaseUsages: PhaseUsage[] = [];

    for (const phase of chain.phases) {
      // FR-009: Check abort before starting a new phase
      if (options.signal?.aborted) {
        const partialResults = completedPhases.map((cp, i) => ({
          phaseIndex: cp.phase.phaseIndex,
          output: cp.output,
          usage: phaseUsages[i],
        }));
        yield createChainErrorEvent(phase.phaseIndex, "Chain aborted");
        yield createChainCompleteEvent(
          aggregateUsage(phaseUsages, this.pricingTable),
        );
        return;
      }

      // Emit phase_start (FR-007)
      yield createPhaseStartEvent(phase);

      // Build messages for this phase
      const { messages, systemPrompt } = buildPhaseMessages(
        options.messages,
        completedPhases,
        phase,
      );

      let phaseOutput = "";
      let phaseTokenUsage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };

      try {
        const stream = this.provider.stream(
          phase.providerId,
          phase.modelId,
          {
            messages,
            maxTokens: phase.maxTokens,
            temperature: phase.temperature,
            systemPrompt,
            signal: options.signal,
          },
        );

        for await (const event of stream) {
          // Augment with phaseIndex and yield
          yield augmentEventWithPhase(event, phase.phaseIndex);

          // Collect text output from deltas
          if (event.type === "text_delta") {
            phaseOutput += event.delta;
          }

          // Fall back to text_complete if no deltas were received
          if (event.type === "text_complete" && phaseOutput === "") {
            phaseOutput = event.text;
          }

          // Capture usage from message_complete
          if (event.type === "message_complete") {
            phaseTokenUsage = event.usage;
          }
        }
      } catch (err) {
        // FR-008: Phase failure halts chain, preserves partial output
        const errorMessage = err instanceof Error ? err.message : String(err);
        yield createChainErrorEvent(phase.phaseIndex, errorMessage);

        // Still emit chain:complete with partial usage
        yield createChainCompleteEvent(
          aggregateUsage(phaseUsages, this.pricingTable),
        );

        throw new ChainError(
          `Phase ${phase.phaseIndex} (${phase.providerId}:${phase.modelId}) failed: ${errorMessage}`,
          phase.phaseIndex,
          err instanceof Error ? err : undefined,
        );
      }

      // Record phase usage
      const usage = createPhaseUsage(phase, phaseTokenUsage);
      phaseUsages.push(usage);

      // Emit phase_end (FR-007)
      yield createPhaseEndEvent(phase.phaseIndex, usage);

      // Store output for next phase's context injection
      completedPhases.push({ output: phaseOutput, phase });
    }

    // Emit chain:complete (FR-007)
    yield createChainCompleteEvent(
      aggregateUsage(phaseUsages, this.pricingTable),
    );
  }
}

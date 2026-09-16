---
id: "062-multi-model-chaining"
title: "Multi-Model Chaining"
feature_branch: "062-multi-model-chaining"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Multi-model chaining pipeline: call Model A (reasoning model) for deep analysis,
  wrap its output in thinking tags, inject as an assistant message, then call
  Model B (response model) for the final response. Per-request token usage
  aggregation across all providers in a chain with configurable pricing tables.
  SSE streaming across multi-phase model calls so consumers see incremental
  output from each phase without waiting for the full chain to complete.
code_aliases:
  - MULTI_MODEL_CHAIN
sources:
  - deepreasoning
  - ruflo
establishes:
  - unit: { kind: directory, path: product/packages/multi-model-chaining }
references:
  - role: historical
    unit: { kind: file, path: crates/agent/src/chain.rs }
---

# Feature Specification: Multi-Model Chaining

## Purpose

Complex tasks benefit from different models at different stages — a reasoning-optimized model for analysis and planning, and a fast response model for generating the user-facing output. Currently the platform can only dispatch a single model per request. There is no mechanism to chain model calls, pass intermediate output between phases, or aggregate token usage and costs across a multi-model pipeline. Streaming is also all-or-nothing: consumers either get the final response stream or nothing.

This feature introduces multi-model chaining, where a request flows through a configurable sequence of model calls. The output of each phase is transformed and injected into the next phase's context. Token usage is aggregated across all phases with configurable pricing tables for cost tracking. SSE streaming delivers incremental output from each phase so consumers see progress throughout the chain.

## Scope

### In scope

- **Chain definition**: A `ModelChain` configuration specifying an ordered sequence of model phases, each with a provider, model, and output transformation rule.
- **Thinking-tag injection**: The output of a reasoning phase is wrapped in `<thinking>` tags and injected as an assistant message prefix for the next phase.
- **Per-request token aggregation**: Token usage (input, output, cache read, cache write) is tracked per phase and aggregated into a single per-request summary.
- **Configurable pricing tables**: Per-model pricing (cost per input token, cost per output token) loaded from configuration, used to compute per-request cost estimates.
- **SSE streaming across phases**: Consumers receive SSE events from each phase as they happen, with phase markers indicating transitions between models.
- **Phase metadata in events**: Each streamed event includes the phase index and model identifier so consumers can attribute output to the correct model.

### Out of scope

- **Dynamic model selection**: Choosing which model to use based on prompt content or intermediate results is a higher-level routing concern.
- **Parallel model calls**: This feature covers sequential chaining only; fan-out to multiple models simultaneously is deferred.
- **Caching of intermediate results**: Memoizing reasoning phase output for identical prompts is a follow-on optimization.
- **UI for chain configuration**: Chains are configured programmatically or via settings; no UI builder is included.

## Requirements

### Functional

- **FR-001**: A `ModelChain` is defined as an ordered list of `ChainPhase` entries, each specifying a provider id, model id, role in the chain (e.g., "reasoning", "response"), and an output transformation.
- **FR-002**: When a chain executes, Phase 1 (reasoning model) receives the user's original messages and returns its output. The chain engine wraps this output in `<thinking>...</thinking>` tags.
- **FR-003**: Phase 2 (response model) receives the original messages plus an injected assistant message containing the thinking-tagged output from Phase 1, then generates the final response.
- **FR-004**: Chains support more than two phases. Each phase's output is transformed according to its `outputTransform` configuration and injected into the next phase's message history.
- **FR-005**: Token usage is tracked per phase. A `ChainUsage` object aggregates `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` across all phases, plus per-phase breakdowns.
- **FR-006**: A pricing table maps `(providerId, modelId)` to `(inputTokenCost, outputTokenCost)` per million tokens. The chain engine computes estimated cost per request using the aggregated usage and the pricing table.
- **FR-007**: SSE streaming emits events from each phase as they are generated. Phase transition events (`chain:phase_start`, `chain:phase_end`) delineate phase boundaries in the stream.
- **FR-008**: If any phase fails (provider error, timeout, abort), the chain halts and returns a structured error indicating which phase failed and why. Partial output from completed phases is preserved.
- **FR-009**: A chain can be aborted mid-execution. The abort signal cancels the currently active phase and skips remaining phases.

### Non-functional

- **NF-001**: Phase transition overhead (output transformation + message injection) adds < 10ms between phases.
- **NF-002**: SSE events from Phase 2 begin streaming within 100ms of Phase 1 completing (excluding model latency).
- **NF-003**: Pricing table lookups are O(1) via hash map.

## Architecture

### Chain configuration

```typescript
interface ChainPhase {
  phaseIndex: number;
  providerId: string;
  modelId: string;
  role: "reasoning" | "response" | "custom";
  outputTransform: "thinking_tags" | "system_prompt" | "raw" | TransformFn;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

interface ModelChain {
  id: string;
  name: string;
  phases: ChainPhase[];
}

type TransformFn = (phaseOutput: string, phaseIndex: number) => string;
```

### Token usage and pricing

```typescript
interface PhaseUsage {
  phaseIndex: number;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface ChainUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  phases: PhaseUsage[];
  estimatedCostUsd: number;
}

interface PricingEntry {
  providerId: string;
  modelId: string;
  inputTokenCostPerMillion: number;
  outputTokenCostPerMillion: number;
}

type PricingTable = Map<string, PricingEntry>; // key: "providerId:modelId"
```

### SSE event extensions

```typescript
type ChainEvent =
  | { type: "chain:phase_start"; phaseIndex: number; providerId: string; modelId: string }
  | { type: "chain:phase_end"; phaseIndex: number; usage: PhaseUsage }
  | { type: "chain:complete"; usage: ChainUsage }
  | { type: "chain:error"; phaseIndex: number; error: string }
  | AgentEvent; // All standard AgentEvent types, augmented with phaseIndex
```

### Execution flow

```
User request arrives
  |
  v
ChainEngine resolves ModelChain config
  |
  +---> Phase 1: reasoning model
  |       |
  |       +---> stream() via ProviderRegistry.get(phase1.providerId)
  |       +---> SSE events emitted with phaseIndex=0
  |       +---> Collect full output text
  |       +---> Apply outputTransform: wrap in <thinking>...</thinking>
  |
  +---> Phase 2: response model
  |       |
  |       +---> Inject transformed Phase 1 output as assistant message
  |       +---> stream() via ProviderRegistry.get(phase2.providerId)
  |       +---> SSE events emitted with phaseIndex=1
  |
  +---> Aggregate token usage across phases
  +---> Compute estimated cost from pricing table
  +---> Emit chain:complete with ChainUsage
```

## Implementation approach

1. **Phase 1 — chain configuration and engine core**: Define `ModelChain`, `ChainPhase` types and implement `ChainEngine` that executes a sequential chain of provider calls.
2. **Phase 2 — thinking-tag transformation**: Implement the `thinking_tags` output transform that wraps reasoning model output in `<thinking>` tags and injects it as an assistant message prefix.
3. **Phase 3 — SSE streaming across phases**: Pipe each phase's `stream()` output to the consumer with phase transition markers (`chain:phase_start`, `chain:phase_end`).
4. **Phase 4 — token aggregation**: Implement `PhaseUsage` collection from each phase's `message_complete` event and aggregate into `ChainUsage`.
5. **Phase 5 — pricing tables**: Add `PricingTable` configuration, loader, and cost computation from aggregated usage.
6. **Phase 6 — error handling and abort**: Implement chain halt on phase failure with partial result preservation, and abort signal propagation.

## Success criteria

- **SC-001**: A two-phase chain (reasoning model + response model) produces a final response where the response model's context includes the reasoning model's output wrapped in `<thinking>` tags.
- **SC-002**: SSE consumers receive events from both phases with correct `phaseIndex` values and phase transition markers.
- **SC-003**: `ChainUsage` accurately reports per-phase and aggregate token counts after a chain completes.
- **SC-004**: Estimated cost computed from the pricing table matches expected values for known token counts and pricing entries.
- **SC-005**: Aborting a chain during Phase 1 prevents Phase 2 from executing and returns partial results.
- **SC-006**: A chain with a failing Phase 1 returns a structured error identifying the failed phase.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 042-multi-provider-agent-registry | Chain phases dispatch through providers registered in the ProviderRegistry |
| 035-agent-governed-execution | Chain execution is a governed action; each phase may be subject to safety tier rules |

## Risk

- **R-001**: Reasoning model output may be very large, inflating the context window for the response model. Mitigation: configurable max token limits per phase; optional summarization transform between phases.
- **R-002**: Latency compounds across phases — a two-phase chain takes at least 2x the single-model latency. Mitigation: streaming mitigates perceived latency; phase-level timeouts prevent unbounded waits.
- **R-003**: Pricing tables require manual maintenance as providers update pricing. Mitigation: pricing tables are loaded from configuration files that can be updated independently of code deployments.

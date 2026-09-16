---
id: "042-multi-provider-agent-registry"
title: "Multi-Provider Agent Registry"
feature_branch: "042-multi-provider-agent-registry"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
revised: "2026-04-15"
authors:
  - "open-agentic-platform"
language: en
risk: medium
depends_on:
  - "035-agent-governed-execution"
  - "036-safety-tier-governance"
  - "068-permission-runtime"
  - "090-governance-non-optionality"
  - "098-governance-enforcement-stitching"
summary: >
  Rust crate providing a unified ProviderAdapter trait and ProviderRegistry that
  normalises multiple LLM backends (Anthropic, OpenAI, Gemini, Bedrock) behind a
  common AgentEvent stream. Every provider dispatch is governed via PolicyEvaluator
  and ToolCallContext integration. Replaces the prior TypeScript scaffold with
  native Rust execution, eliminating the Node.js sidecar subprocess in the desktop
  app's orchestrator path.
code_aliases:
  - PROVIDER_REGISTRY
establishes:
  - unit: { kind: crate, id: provider-registry }
---

# Feature Specification: Multi-Provider Agent Registry

## Revision history

| Date | Change |
|------|--------|
| 2026-03-29 | Initial draft targeting TypeScript |
| 2026-04-15 | Rewrite targeting Rust. Governance integration added. TS scaffold superseded. |

## Purpose

The platform couples agent execution to a single LLM backend (Claude Code CLI via `ClaudeCodeExecutor` in `crates/orchestrator/`). Multiple provider backends are needed for model routing, cost optimization, and provider redundancy. A prior TypeScript implementation (`product/packages/provider-registry/`) exists as a scaffold but was never tested against live APIs, has broken sidecar-to-Rust protocol integration, and sits outside the governed Rust execution path.

This feature introduces a Rust `ProviderRegistry` crate that normalises all LLM backends behind a common `ProviderAdapter` trait, so that orchestration code never depends on a specific provider's wire format or lifecycle model. Every provider dispatch passes through `policy_kernel::evaluate()` before execution.

## Scope

### In scope

- **`ProviderAdapter` trait**: Async trait with `spawn`, `query`, `stream`, `abort` operations that every backend implements.
- **`ProviderRegistry`**: Thread-safe registry managing adapter registration, lookup by id, and capability discovery.
- **`AgentEvent` enum**: Serde-tagged union normalising all provider output into a single event stream.
- **Built-in adapters**: Anthropic Messages API, OpenAI Chat Completions, Google Gemini, AWS Bedrock. Each uses `reqwest` + SSE parsing directly (no vendor SDK crates except AWS).
- **Governance integration**: `GovernedProviderRegistry` wrapper evaluating `ToolCallContext` via `policy_kernel::evaluate()` before every dispatch.
- **Orchestrator integration**: `ProviderRegistryExecutor` implementing `GovernedExecutor` alongside existing `ClaudeCodeExecutor`.
- **Desktop integration**: Tauri commands route through Rust `ProviderRegistryExecutor` instead of spawning a Node.js sidecar.
- **TS scaffold retirement**: `product/packages/provider-registry/` removed after Rust replacement is wired.

### Out of scope

- **Agent orchestration logic**: This feature provides the provider layer; multi-agent coordination is separate.
- **Prompt routing / model selection**: Intelligent routing built on top of the registry is a follow-on.
- **Cost tracking / billing**: Usage metering per provider is a follow-on.
- **Provider-specific advanced features**: Batch API, assistants API, etc. remain provider-specific.
- **UI changes**: No desktop or web UI changes.

## Requirements

### Functional

- **FR-001**: A `ProviderRegistry` allows registering and retrieving `ProviderAdapter` instances by string id (e.g., `"anthropic"`, `"openai"`, `"gemini"`, `"bedrock"`).
- **FR-002**: Each `ProviderAdapter` implements `spawn()` to create a session, `query()` for single-turn request/response, `stream()` returning `Pin<Box<dyn Stream<Item = Result<AgentEvent, ProviderError>>>>`, and `abort()` to cancel in-flight operations.
- **FR-003**: All adapters emit events conforming to the `AgentEvent` enum. Adapter-specific normalisers translate native SSE/JSON formats into `AgentEvent` before delivery.
- **FR-004**: `ProviderRegistry::list()` returns all registered adapters with their declared capabilities.
- **FR-005**: Registration fails with `ProviderError::AlreadyRegistered` if a duplicate id is registered.
- **FR-006**: Missing or invalid API keys produce `ProviderError::MissingApiKey` from `spawn()` and `query()`.
- **FR-007**: `stream()` returns an owned `Stream` that the consumer can drop, triggering cleanup via the adapter's cancellation token.
- **FR-008**: `GovernedProviderRegistry` evaluates `policy_kernel::evaluate()` with a `ToolCallContext` before every `query()` and `stream()` call. `PolicyOutcome::Deny` returns `ProviderError::GovernanceDenied`.
- **FR-009**: `ProviderRegistryExecutor` implements `GovernedExecutor` and coexists with `ClaudeCodeExecutor`. Provider selection uses `provider_id:model` syntax in `DispatchRequest.agent_id`.

### Non-functional

- **NF-001**: Adding a new adapter requires implementing `ProviderAdapter` only — no changes to registry core or event types.
- **NF-002**: Event normalisation adds < 5ms p99 overhead per event over raw HTTP latency.
- **NF-003**: The registry is thread-safe (`Arc<RwLock<...>>`) for concurrent adapter access.
- **NF-004**: Gemini and Bedrock adapters are behind cargo feature flags (`gemini`, `bedrock`) to avoid mandatory heavy dependencies.

## Architecture

### Crate location

```
crates/provider-registry/
  Cargo.toml
  src/
    lib.rs                      -- ProviderAdapter trait, re-exports
    types.rs                    -- AgentEvent, Role, TokenUsage, QueryParams, etc.
    error.rs                    -- ProviderError (thiserror)
    registry.rs                 -- ProviderRegistry (Arc<RwLock<HashMap>>)
    governed.rs                 -- GovernedProviderRegistry (policy-kernel integration)
    adapters/
      mod.rs
      anthropic.rs              -- Anthropic Messages API (reqwest + SSE)
      openai.rs                 -- OpenAI Chat Completions (reqwest + SSE)
      gemini.rs                 -- Google Gemini (reqwest + JSON streaming) [feature: gemini]
      bedrock.rs                -- AWS Bedrock Converse (aws-sdk) [feature: bedrock]
    normalization/
      mod.rs
      anthropic.rs              -- Anthropic SSE -> AgentEvent
      openai.rs                 -- OpenAI SSE -> AgentEvent
      gemini.rs                 -- Gemini JSON -> AgentEvent [feature: gemini]
      bedrock.rs                -- Bedrock stream -> AgentEvent [feature: bedrock]
```

### Key type definitions (Rust)

```rust
/// Normalised event emitted by all providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TextDelta { delta: String },
    TextComplete { text: String },
    ToolUseStart { tool_call_id: String, tool_name: String },
    ToolUseDelta { tool_call_id: String, delta: String },
    ToolUseComplete { tool_call_id: String, input: Value },
    ToolResult { tool_call_id: String, output: Value, is_error: bool },
    ThinkingDelta { delta: String },
    ThinkingComplete { text: String },
    MessageStart { role: Role, model: String },
    MessageComplete { stop_reason: String, usage: TokenUsage },
    Error { code: String, message: String, retryable: bool },
}

/// The trait every LLM backend must implement.
#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn id(&self) -> &str;
    fn capabilities(&self) -> &ProviderCapabilities;
    async fn spawn(&self, config: Option<&ProviderConfig>)
        -> Result<AgentSession, ProviderError>;
    async fn query(&self, session: &AgentSession, params: QueryParams)
        -> Result<Vec<AgentEvent>, ProviderError>;
    fn stream(&self, session: AgentSession, params: QueryParams)
        -> Pin<Box<dyn Stream<Item = Result<AgentEvent, ProviderError>> + Send + 'static>>;
    async fn abort(&self, session: &AgentSession) -> Result<(), ProviderError>;
}

/// Thread-safe registry of provider adapters.
pub struct ProviderRegistry {
    adapters: Arc<RwLock<HashMap<String, Arc<dyn ProviderAdapter>>>>,
}

/// Governance-aware wrapper.
pub struct GovernedProviderRegistry {
    inner: ProviderRegistry,
    policy_bundle: Arc<PolicyBundle>,
}
```

### Governance integration

```
Caller (orchestrator / Tauri command)
  |
  v
GovernedProviderRegistry.governed_query(provider_id, session, params)
  |
  +---> Build ToolCallContext { tool_name: "provider_query:{id}", ... }
  +---> policy_kernel::evaluate(&ctx, &bundle)
  |       |
  |       +---> PolicyOutcome::Deny  -> ProviderError::GovernanceDenied
  |       +---> PolicyOutcome::Allow -> continue
  |
  +---> inner.get(provider_id)?.query(session, params)
  |
  v
Vec<AgentEvent> / Stream<AgentEvent>
```

### Orchestrator integration

`ProviderRegistryExecutor` implements `GovernedExecutor` from `crates/orchestrator/`:

```
DispatchRequest { agent_id: "anthropic:claude-sonnet-4-20250514", ... }
  |
  v
ProviderRegistryExecutor::dispatch_step()
  |
  +---> Parse "anthropic" + "claude-sonnet-4-20250514" from agent_id
  +---> registry.governed_query("anthropic", session, params)
  +---> Collect stream -> extract TokenUsage from MessageComplete
  +---> Return DispatchResult { tokens_used, cost_usd, duration_ms, ... }
```

### Event normalisation flow

```
Provider HTTP response (SSE / JSON stream)
  |
  v
Adapter-specific normaliser (e.g., normalization::anthropic)
  |
  v
AgentEvent (unified enum)
  |
  v
Consumer (orchestrator, Tauri command, logger)
```

## Implementation approach

1. **Phase 1 — Core types and registry**: `AgentEvent`, `ProviderAdapter`, `ProviderRegistry`, `ProviderError` in `crates/provider-registry/`. Add to workspace.
2. **Phase 2 — Anthropic adapter**: Reference implementation using `reqwest` + `eventsource-stream` for SSE. Stateful `AnthropicStreamNormalizer`. Abort via `tokio_util::CancellationToken`.
3. **Phase 3 — OpenAI adapter**: Second adapter validating the trait design. Same SSE pattern.
4. **Phase 4 — Governance integration**: `GovernedProviderRegistry` wiring `policy_kernel::evaluate()`. Unit tests with deny/allow policy rules.
5. **Phase 5 — Orchestrator migration**: `ProviderRegistryExecutor` implementing `GovernedExecutor`. Coexists with `ClaudeCodeExecutor`.
6. **Phase 6 — Tauri command wiring**: Replace `dispatch_via_provider_registry` Node subprocess path with Rust `ProviderRegistryExecutor`.
7. **Phase 7 — Gemini and Bedrock**: Feature-flagged adapters. Gemini via REST JSON streaming. Bedrock via `aws-sdk-bedrockruntime`.
8. **Phase 8 — TS scaffold retirement**: Remove `product/packages/provider-registry/`, clean workspace references.

## Success criteria

- **SC-001**: `ProviderRegistry` can register and retrieve at least two different adapters (Anthropic + OpenAI).
- **SC-002**: A streaming query through the Anthropic adapter emits well-formed `AgentEvent` values that a consumer can iterate with `StreamExt::next()`.
- **SC-003**: The same consumer code works unchanged when swapped to the OpenAI adapter — only the provider id changes.
- **SC-004**: `abort()` on an in-flight streaming session terminates the stream and cleans up resources without panicking.
- **SC-005**: Registering a duplicate provider id returns `ProviderError::AlreadyRegistered`.
- **SC-006**: A provider with a missing API key returns `ProviderError::MissingApiKey` from `spawn()`.
- **SC-007**: `GovernedProviderRegistry` denies a query when the policy bundle contains a matching deny rule.
- **SC-008**: `ProviderRegistryExecutor::dispatch_step()` returns a `DispatchResult` with populated `tokens_used` from a successful provider call.
- **SC-009**: The desktop app's orchestrator path no longer spawns a Node.js subprocess for `provider:model` agent ids.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 035-agent-governed-execution | Governed dispatch routes through providers |
| 036-safety-tier-governance | Safety tiers apply to provider-dispatched tool calls |
| 068-permission-runtime | Permission settings layering feeds into PolicyBundle |
| 090-governance-non-optionality | Governance is non-optional; every provider call is governed |
| 098-governance-enforcement-stitching | Stitching ensures governance gates are connected end-to-end |

## Risk

- **R-001**: No official Anthropic or OpenAI Rust SDKs. Mitigation: use `reqwest` + `eventsource-stream` for SSE; normaliser tests use recorded fixtures to catch format regressions.
- **R-002**: Normalising all providers to a single event format may lose provider-specific metadata. Mitigation: `AgentEvent` covers the common surface; provider-specific data can be logged or attached via session metadata.
- **R-003**: Bedrock requires the full AWS SDK dependency tree. Mitigation: behind a `bedrock` cargo feature flag, disabled by default.
- **R-004**: SSE format changes from providers could break normalisers silently. Mitigation: fixture-based unit tests with recorded real responses; integration tests behind a feature flag for CI with API keys.

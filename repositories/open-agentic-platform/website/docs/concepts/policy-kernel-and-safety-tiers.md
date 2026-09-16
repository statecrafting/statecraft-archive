# Policy Kernel and Safety Tiers

When autonomous agents operate within a repository, they must be constrained by strict boundaries to prevent unintended modifications or destructive actions. OAP manages this through the Policy Kernel and Safety Tiers.

## Safety Tiers (Spec 036)

Every tool available to an agent via the `axiomregent` MCP server is classified into one of three Safety Tiers:

- **Tier 1 (Autonomous)**: Safe, read-only tools that cannot mutate state or leak secrets. Examples include `snapshot.read`, `xray.scan`, and `run.logs`. Agents can use these tools freely without explicit permission.
- **Tier 2 (Gated)**: Tools that mutate state but are bounded by scope or impact. Examples include writing to specific allowed directories or creating a branch. These require appropriate policy grants.
- **Tier 3 (Manual)**: Destructive, unclassified, or highly privileged tools. Examples include arbitrary shell execution or deleting resources. These tools trigger the `tool_allowlist` gate (CONST-003) and require explicit human approval.

By default, any new or unclassified tool is treated as Tier 3.

## The Policy Kernel

The Policy Kernel (`crates/policy-kernel/`) is the enforcement engine that evaluates whether an agent is allowed to take a specific action.

It operates on a 5-tier settings merge model, evaluating policies across different scopes:
1. Global repository defaults
2. Domain-specific rules
3. Project-level grants
4. Session-specific constraints
5. Per-tool execution limits

When an agent attempts to invoke a tool, the Policy Kernel evaluates the tool's Safety Tier against the merged policy bundle and the session's `max_tier` ceiling. If the action violates the policy, the Kernel blocks the execution and returns an error to the agent, halting the workflow.

## Policy Rules in Practice

OAP defines several core policies (CONST-001 through CONST-005) in the root `CLAUDE.md` file. These are real, enforced rules, not just guidelines:

- **CONST-001**: Blocks destructive file/git operations without explicit confirmation.
- **CONST-002**: Prevents committing API keys, tokens, or `.env` files (Secrets Scanner).
- **CONST-003**: Warns when Tier 3 tools are invoked without approval.
- **CONST-004**: Warns when a single patch exceeds 500 lines.
- **CONST-005**: Refuses instructions that engineer drift between spec and code (Spec-Code Coherence).

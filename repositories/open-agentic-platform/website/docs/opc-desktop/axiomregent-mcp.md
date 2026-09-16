# Axiomregent MCP

At the heart of the OPC Desktop is `axiomregent`, the governed Model Context Protocol (MCP) server. It acts as the gatekeeper between the autonomous agent and the local filesystem.

## The Unification (Spec 073)

Historically, OAP used several fragmented tools (e.g., `gitctx` for Git, `blockoli` for semantic search). Spec 073 unified these disparate tools into a single, cohesive MCP server: `axiomregent`.

This unification solved several structural problems:
- **Fragmented Tool Surface**: All tools now pass through a single governance layer.
- **Ephemeral State**: `axiomregent` uses `hiqlite` for persistent, cross-session coordination.
- **GitHub Org Integration**: It brokers GitHub App installation tokens through the platform, providing governed API access.

## Tool Dispatch and Safety Tiers

When an agent (like Claude Code) requests to use a tool, `axiomregent` intercepts the request. It checks the tool's classification against the Safety Tiers (Spec 036):

- **Tier 1**: Autonomous (Read-only)
- **Tier 2**: Gated (Scoped mutation)
- **Tier 3**: Manual (Destructive/Unclassified)

The server then evaluates the session's `max_tier` ceiling and the project's policy grants. If the action is permitted, it executes the tool; otherwise, it blocks the request and returns a policy violation error to the agent.

## Distributed Worktree Locks

To prevent concurrent agents from corrupting the repository, `axiomregent` implements distributed worktree locks. Before executing a mutating tool (Tier 2 or Tier 3), it acquires a lock on the target path. This ensures that changes are applied sequentially and deterministically.

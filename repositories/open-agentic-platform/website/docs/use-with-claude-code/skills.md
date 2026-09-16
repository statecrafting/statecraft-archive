# Skills

Skills are the primary surface for slash commands in the Claude Code integration (post-Spec 182). They live in the `.claude/skills/` directory, with one folder per skill containing a `SKILL.md` entrypoint.

## Available Skills

OAP currently provides eleven core skills:

- **`/init`**: Initializes a session by loading context, recent activity, and governed reads of the registry and codebase index.
- **`/setup`**: A one-time contributor setup that installs the `spec-spine` CLI, builds overlay binaries, and verifies governed reads.
- **`/commit`**: Creates a git commit with an impact-focused conventional message.
- **`/code-review`**: Performs a multi-aspect, staged adversarial code review (this skill absorbed the legacy `/review-branch` command).
- **`/implement-plan`**: Executes a plan file step-by-step with progress tracking and phase checkpoints.
- **`/research`**: Conducts deep research using parallel sub-agents and query classification.
- **`/validate-and-fix`**: Runs quality checks and automatically attempts to fix identified issues.
- **`/cleanup`**: Detects dead code and duplicates, providing categorized recommendations.
- **`/refactor-claude-md`**: Modularizes large `CLAUDE.md` files using path-scoped rules.
- **`/ship`**: Manages the end-to-end process of gate validation, review, commit, and PR creation with waiver and evidence discipline.
- **`/shepherd-prs`**: Handles the post-creation PR lifecycle, including infra reruns, comment triage, and merge verification.

*(Note: The legacy `.claude/commands/` directory is retired and kept empty by design to serve as an indexer walk root).*

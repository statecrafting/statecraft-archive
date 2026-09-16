# Configuration and Governance

When operating autonomously, Claude Code must respect the project's strict configuration and governance boundaries.

## Handling Configuration

Claude is instructed never to hardcode configuration values or secrets. It must always use the established mechanisms:

1. **Environment Variables**: For non-sensitive configuration, Claude should update `apps/api/.env.example` and instruct the user to update their local `.env`.
2. **Encore Secrets**: For sensitive credentials, Claude should use the `encore secret set` command. It is strictly forbidden from logging or committing secrets.

## Navigating the Spec Spine

The most important constraint on Claude's autonomy is the **spec-spine coupling gate**.

If Claude is asked to implement a feature or change existing behavior, it must:
1. Identify if the affected code is governed by an existing specification.
2. If it is, Claude must update the markdown specification *before* or *alongside* the code changes.
3. If the change represents a new architectural decision, Claude must draft a new specification.
4. After modifying any specification, Claude must run `npx spec-spine compile` to update the index.

If Claude fails to do this, the `spec-spine` CI job will fail, and the PR will be blocked. The `/validate-and-fix` skill includes a step to run the spec-spine checks locally to catch this before committing.

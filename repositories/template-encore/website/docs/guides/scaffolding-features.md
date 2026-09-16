# Scaffolding Features

To accelerate development and ensure consistency, **acme-vue-encore** provides a Claude Code skill for scaffolding new features.

## The `scaffold-feature` Skill

The `scaffold-feature` skill automates the creation of vertical slices of functionality, touching both the backend and the frontend. It is located at `.claude/skills/scaffold-feature/SKILL.md`.

### What it Generates

When invoked, the skill generates:

1. **Backend Endpoint**: A new Encore `api()` endpoint in the specified service directory.
2. **Database Migration**: A new `.up.sql` migration file if the feature requires schema changes.
3. **Frontend Component**: A new Vue 3 SFC (Single-File Component) using PrimeVue.
4. **Client Regeneration**: It automatically runs `npm --prefix apps/api run gen:client` to update the typed Encore client.

### How to Use It

If you are using Claude Code, you can invoke the skill by asking Claude to scaffold a feature. For example:

> "Use the scaffold-feature skill to create a 'User Profile' feature in the 'users' service, including a database table for profiles and a frontend view in apps/web."

Claude will read the `SKILL.md` file, execute the defined steps, and produce the necessary code, ensuring it adheres to the repository's architectural and security invariants.

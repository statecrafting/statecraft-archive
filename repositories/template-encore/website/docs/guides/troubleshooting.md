# Troubleshooting

Common issues and solutions when developing with **acme-vue-encore**.

## Missing Dependencies

**Symptom**: `Error: Cannot find module '...'` or TypeScript compilation errors.

**Cause**: The project requires two separate `npm install` steps because `apps/api` is excluded from the root workspaces.

**Solution**:
```bash
npm install
cd apps/api && npm install
```

## JWT Key Errors

**Symptom**: `Error: ENOENT: no such file or directory, open '.../apps/api/keys/private.pem'` during backend startup.

**Cause**: The development JWT signing keys have not been generated.

**Solution**:
```bash
cd apps/api
npm run generate-keys
```

## Database Connection Refused

**Symptom**: `connect ECONNREFUSED 127.0.0.1:5432` or similar database errors when running `npm run dev`.

**Cause**: Encore requires Docker to automatically provision the local Postgres database. Docker is likely not running.

**Solution**: Start Docker Desktop (or the Docker daemon) and try `npm run dev` again.

## Spec-Spine Coupling Gate Failure

**Symptom**: The CI pipeline fails on the `spec-spine` job with a message like "Codebase index staleness gate" or "Spec/code coupling gate".

**Cause**: You modified code that is governed by a specification, but you did not update the corresponding spec in the same commit, or you forgot to re-run the index compiler.

**Solution**:
1. If you modified governed code, you must also edit the corresponding `specs/` markdown file to document the change.
2. Run `npx spec-spine compile` locally to update the `spec-spine-index.json`.
3. Commit the updated index and spec changes.

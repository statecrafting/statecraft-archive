<!-- Spec-Linkage: 005-factory-service -->
# factory (spec 005)

Turns "customer wants an app named X" into a born-green repo in the customer's
GitHub org: export the pinned enrahitu template, read its `template.toml`
contract (and nothing else), run the scaffold verb with the slot values, emit
the born-with certificate and anchor it in the governance ledger, then land it
(create a new repo and push, or adopt an existing repo via a pull request), and
watch the born-with verify workflow until green. Completes milestone M2 with
spec 004. The contract boundary is absolute: any factory behavior that depends
on template internals beyond `template.toml` is a defect.

## Files

- `config.ts`: pinned template ref (`FACTORY_TEMPLATE_REF`, default a recorded
  enrahitu SHA at contract 0.5.0), repo URL, data dir, timeouts.
- `contract.ts`: a small self-contained `template.toml` reader + version gating
  (`>=0.1.0 <1.0.0`) + slot validation + capability gates. Pure, unit-tested.
- `cert.ts`: builds the born-with cert and computes its keysorted-canonical
  sha256, byte-identical to the template's `verify-born-with.mjs`. Pure, tested
  against the golden fixture.
- `entities.ts` / `store.ts`: the `StampJob` CoreLedger entity + data access;
  idempotent job creation and state-machine-guarded transitions.
- `jobs.ts`: the status state machine (`queued -> stamping -> pushing ->
  verifying -> green`, `failed` from any live state). Pure, tested.
- `attest.ts`: the governance-ledger attestation payload + the stamp-mode
  guard. Pure, unit-tested; the actual `governance.record` call lives in
  `pipeline.ts` (the IO boundary).
- `git.ts` / `scaffold.ts` / `github.ts`: the IO layer (git archive/push, the
  scaffold verb, repo creation, existing-repo clone + overlay + PR, verify
  polling).
- `pipeline.ts`: the async stamp pipeline; capabilities gated on the contract
  version actually read (scaffold verb, cert emission), branched on the stamp
  mode (create vs adopt), and anchoring the cert in the governance ledger
  before any repo mutation.
- `api.ts`: the `/api/v1` endpoints.

## API

Auth as spec 004 (owner-scoped through the tenant):

- `POST /api/v1/tenants/:id/stamps`
  `{ appName, targetOrg, frontend?, posture, mode? }`: queue a stamp and kick
  the pipeline. `posture` is required (REQUEST-EXPLICIT:
  `none | assisted | autonomous`), never defaulted. `mode` is `create`
  (default: new repo) or `adopt` (PR the chassis onto an existing repo).
  Idempotent: a live job for the same tenant + appName is returned as-is.
- `GET /api/v1/stamps/:jobId`: job status.
- `GET /api/v1/tenants/:id/stamps`: the tenant's stamp jobs.

## Contract coupling

The factory pins `FACTORY_TEMPLATE_REF` to a known-good enrahitu commit (never
floating main). The current pin is contract 0.5.0, which has the scaffold verb
(v0.4) and the `[provenance]` cert table (v0.3), so the factory takes the
preferred scaffold + cert path. Capabilities are gated on the contract version
actually read, so a repointed older pin degrades (v0 factory-side substitution,
cert skipped) rather than breaking, and a newer pin upgrades automatically.

Signed certificates (born-with certVersion 2) are out of scope here (spec 005
§5); step 3 emits the unsigned v1 cert by design.

## Manual e2e (spec 005 §4)

Documented click path (needs spec 004's installation + the App secrets):

1. Log in; create a tenant; install the App into an org (spec 004 flow).
2. `POST /api/v1/tenants/:id/stamps { "appName": "smoke-<date>", "targetOrg":
   "<org>", "posture": "assisted" }` -> job id.
3. Poll `GET /api/v1/stamps/:jobId` until `status: green`.
4. The resulting repo exists in the customer org and its verify run is green on
   GitHub. This is the M2 core loop.

For **adopt** mode, pass `"mode": "adopt"` with an `appName` that is an existing
repo in the org: the job opens a `factory/adopt-<sha>` pull request instead of
creating a repo, and reaches `green` when the PR's verify run passes. The job's
`prUrl` points at the PR to review and merge.

The pipeline's IO steps (git, scaffold, GitHub) run only in this manual e2e; CI
exercises the pure core (contract parsing, cert hashing, slot validation, the
job state machine, and entity persistence on libSQL + Postgres).

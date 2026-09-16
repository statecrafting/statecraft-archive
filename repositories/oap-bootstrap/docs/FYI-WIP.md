# FYI / WIP: GITHUB_TOKEN in the OAP Hetzner bootstrap

> Captured 2026-06-25. Context for the `oap-bootstrap` CLI: the OAP
> Hetzner `setup.sh` requires an operator `GITHUB_TOKEN`, and the CLI
> will have to supply or broker it when it drives the same bootstrap.
> Source of truth is OAP `platform/infra/hetzner/setup.sh`; this note
> is a working summary, not a contract.

## TL;DR

`GITHUB_TOKEN` is not a repo-stored secret. It is an env var the
**operator exports locally** (from `.env`) before running the one-time
Hetzner bootstrap. The guard at `setup.sh:162` fails fast in pre-flight
if it is missing. It is consumed by `flux bootstrap github`, and it is a
**bootstrap-time-only** credential: after the first run, ongoing GitOps
reconciliation uses a deploy key, not the token.

## Why it is required

The token is consumed by `flux bootstrap github` (OAP
`setup.sh:209-215`). During bootstrap that command authenticates to the
GitHub API to do two things:

1. **Commit the `flux-system/` Kustomization** into the repo's gitops
   path (`--path=platform/gitops/clusters/hetzner-prod`). It writes the
   four Flux controller manifests (source / kustomize / helm /
   notification) plus the self-reconciling `GitRepository` into the
   repo. This needs `Contents: read+write`.
2. **Create the deploy key** that the cluster's source-controller then
   uses to pull the repo for ongoing reconciliation. The deploy-key
   title flux assigns is `flux-system-<branch>-flux-system-<path>`.

The flux CLI reads the token specifically from the `GITHUB_TOKEN`
environment variable. That is flux's own convention, not something the
script invented. The error text asks for a fine-grained PAT with
`Contents: read+write` on the target repo.

## Two properties worth knowing

- **Bootstrap-time-only.** After `flux bootstrap` runs once, steady-state
  reconciliation uses the deploy key it created, not the PAT. So the
  token is needed for initial stand-up (or a DR rebootstrap), not for
  normal operation. Related behavior: `flux bootstrap` does NOT rotate
  the deploy key when the in-cluster `flux-system/sops-age`-adjacent
  deploy-key Secret is already healthy; rotating it is a surgical
  `gh api` POST/DELETE, not a re-bootstrap side effect.
- **Fast-fail placement is deliberate.** The guard sits at `setup.sh:162`
  in the pre-flight block, *before* `hetzner-k3s create` provisions the
  paid cluster at line 171. Failing on a missing token in pre-flight
  avoids spinning up infrastructure and then dying mid-bootstrap at the
  flux step.

## Not the same as the platform GitHub App

This operator PAT is separate from statecraft's GitHub App / token
broker (`platform/services/statecraft/api/github/`). The broker serves
the running platform's webhook and PR-preview flow. `setup.sh` is a
human-operator one-time action that uses the operator's own PAT. Do not
conflate the two when designing the CLI's credential handling.

## Relevance to the oap-bootstrap CLI

- The CLI's M0 footprint in OAP is spec 221 FR-040 (now merged, OAP PR
  #434): the flux-bootstrap seam is fork-parameterized via
  `FLUX_OWNER` / `FLUX_REPO` / `FLUX_BRANCH`, defaulting to the upstream
  owner/repo/branch. An unset `.env` behaves exactly as before; a fork
  sets those three vars. See OAP `setup.sh:205-215` (`# region:
  bootstrap`).
- When the CLI forks OAP into a new org and stands up the estate, it
  must arrange a `GITHUB_TOKEN` (or equivalent) with `Contents:
  read+write` on the **fork's** repo for the flux-bootstrap step, and
  set `FLUX_OWNER` / `FLUX_REPO` / `FLUX_BRANCH` to the fork. The GitHub
  App Manifest flow already drafted in this repo's spec
  `001-oap-instance-bootstrap-cli` is the natural place to mint that
  credential.

## Known stale slugs in setup.sh (cosmetic, not blocking)

A fork audit surfaced two spots in OAP `setup.sh` that still hardcode
`statecrafting/open-agentic-platform` and would mislead a fork
operator. Both are outside spec 221's `bootstrap`-section authority
(they fall under OAP spec 106/143 whole-file authority), so they were
deliberately left out of the 221 closure PR:

- `setup.sh:162` : the `GITHUB_TOKEN` error message names the upstream
  repo in its "export a PAT on ..." hint.
- `setup.sh:596-609` : the post-bootstrap `gh secret set` next-steps
  output. Note the functional path already honors `${GH_REPO:-...}`;
  only the `else`-branch echo fallbacks hardcode the slug.

A small cleanup PR under OAP spec 106/143 authority is the right home
for these, not the CLI.

## Open question / decision

Is the PAT requirement avoidable? `flux bootstrap` can run against an
SSH deploy-key flow (`flux bootstrap git` with an SSH URL + a
pre-created key) instead of `flux bootstrap github` with a PAT. That
would remove the operator-PAT requirement at the cost of pre-seeding an
SSH key. Worth evaluating for the CLI's automated path, where minting
and holding a short-lived PAT vs. generating an ephemeral SSH key is a
real credential-handling trade-off.

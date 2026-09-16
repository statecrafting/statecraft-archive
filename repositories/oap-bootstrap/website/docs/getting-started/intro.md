# Introduction

`oap-bootstrap` is a single-binary Go CLI that stands up a fresh [Open Agentic Platform (OAP)](https://github.com/statecrafting/open-agentic-platform) instance in a brand-new GitHub organization and brings its Hetzner K3s estate online. 

Historically, deploying OAP into a new organization required a multi-hour manual choreography: forking the repository, hand-registering a GitHub App and OAuth App, clicking through the Rauthy interface to create OIDC clients, pointing DNS records, populating a 151-line `.env` file, and running a 621-line `setup.sh` script in two gated passes. `oap-bootstrap` replaces this entire sequence with a single, resumable, and mostly unattended workflow.

## Wraps, Never Reimplements

A load-bearing design principle of `oap-bootstrap` is that it **wraps the upstream `setup.sh` script, but never reimplements it**. 

The CLI does not provision the cluster itself or contain custom Go logic for GitOps bootstrapping or secret materialization. Instead, it shells out to the forked repository's own `platform/infra/hetzner/setup.sh` script. The automation delta between a manual run and `oap-bootstrap` consists exactly of the steps the upstream script leaves open:
- GitHub App registration via the App Manifest flow.
- Cloudflare DNS record management.
- Rauthy OIDC client creation.
- The fork-and-parameterize steps required to run the organization-coupled upstream tree under a new owner.

By preserving the upstream deployment mechanics, `oap-bootstrap` guarantees that the resulting cluster and configuration exactly mirror a standard OAP deployment.

## Where It Sits

`oap-bootstrap` acts as the initial provisioning orchestrator. It bridges the gap between an empty GitHub organization and a running cluster. 

- **Relative to OAP**: It forks the upstream OAP repository, injects the necessary configuration, and executes its infrastructure setup scripts.
- **Relative to `setup.sh`**: It wraps the script, bridging the securely encrypted configuration into the transient plaintext format the script expects.
- **Relative to `spec-spine`**: The `oap-bootstrap` repository itself is governed by `spec-spine`, adhering to the markdown-truth and compiler-owned-JSON discipline.

Once the `verify` phase completes and the endpoints are healthy, `oap-bootstrap`'s job is done. Day-2 operations, scaling, and upgrades are handled by the Flux GitOps controllers already running in the cluster.

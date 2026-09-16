# Status and Scope

`oap-bootstrap` is an early-stage project with specific goals and intentional boundaries.

## Implementation Status

All implementation milestones (M0 through M5) are fully coded and unit-tested. This includes the `init` and `doctor` commands, the complete phase-by-phase sequence (`github`, `cluster`, `dns`, `identity`, `platform`, `verify`), and the unattended `apply --yes` workflow.

However, **no end-to-end run against a real target has happened yet.** The live cloud, cluster, and Rauthy interactions have not been exercised against Hetzner or GitHub in a production environment. The first real run is the outstanding acceptance gate required to fulfill the success criteria defined in the project specification.

While the implementation is complete, the authoritative design specification (`specs/001-oap-instance-bootstrap-cli/spec.md`) officially remains in a `draft` status until these real-world tests are validated.

## Scope

The current scope of `oap-bootstrap` is strictly limited to deploying OAP on **Hetzner K3s**. This aligns with the upstream platform's primary deployment model.

While the phase dependency graph is designed to accommodate other providers in the future, multi-cloud deployments (such as Azure, AWS, GCP, or DigitalOcean via the upstream Terraform modules) are not currently implemented.

## Non-Goals

The following tasks are explicitly out of scope for this tool:

- **Reimplementing upstream logic**: The CLI will never reimplement `setup.sh`, `post-create.sh`, or the Helm charts in Go. It acts exclusively as a wrapper and orchestrator.
- **Account creation**: Creating the Hetzner account, the GitHub organization, or the DNS zone. The CLI assumes these resources already exist and that you possess scoped tokens to interact with them.
- **Day-2 operations**: Managing upgrades, scaling, or ongoing maintenance. These are GitOps concerns handled by Flux, and the CLI's responsibility ends entirely after the `verify` phase completes successfully.

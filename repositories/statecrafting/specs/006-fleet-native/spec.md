---
id: "006-fleet-native"
title: "The fleet placement core as a napi-rs native addon"
status: approved
created: "2026-07-20"
implementation: complete
depends_on:
  - "000-bootstrap"
  - "001-packages-thesis"
establishes:
  - { kind: directory, path: "addon/fleet-native/" }
summary: >
  The fifth and last package of the spec 001 ladder:
  `@statecrafting/fleet-native`, the control plane's fleet placement
  core. Native kube-rs construction of the EnRaHiTu placement shape
  (Namespace, Deployment, PVC, Service, Ingress, NetworkPolicy) plus
  deploy / status / update / backup / remove, behind a JSON-in /
  JSON-out async napi surface. It arrives by edge transfer from
  statecraft `addon/fleet-native/`, unchanged in behavior and unchanged
  in license: AGPL-3.0, because it is the fleet engine and no stamped
  app touches it. statecraft spec 006 keeps `backend/fleet/`; only this
  one path moves.
---

# 006: The fleet placement core as a napi-rs native addon

## 1. Purpose

fleet-native closes the spec 001 migration ladder. With it, all five
packages the product family consumes are governed by one spine, and no
package is owned by whichever repository happened to build it first.

It is also the package the AGPL shield most exists to protect. Spec 001
section 3 names it directly: fleet-native is the fleet engine, and moving
it to a permissive license would let a competitor host a modified control
plane, fleet orchestration included, without publishing anything. The
license question and the ladder question are independent here, and only
the second one is what this spec answers.

Nothing about the package changes but its address. The Rust is the Rust
statecraft spec 006 landed and proved through a live E2E on the
hetzner-k3s cluster: 12 golden tests over the pure resource builders, and
a real deploy, update, backup and remove against a real cluster. This
spec transfers it; it does not redesign it.

## 2. Territory

A single napi-rs package, `addon/fleet-native/`, plus the per-platform
binary packages napi generates from it:

| Package | Contents |
|---|---|
| `@statecrafting/fleet-native` | the napi loader (`index.js` + `index.d.ts`, built); no binary |
| `@statecrafting/fleet-native-darwin-arm64` | the `.node` for macOS arm64 |
| `@statecrafting/fleet-native-linux-x64-gnu` | the `.node` for linux x64 |
| `@statecrafting/fleet-native-linux-arm64-gnu` | the `.node` for linux arm64 |

The crate is self-contained: `k8s-openapi` (feature `v1_32`, matching the
deployd-api-rs harvest reference and the hetzner-k3s apiserver) and serde
always; `kube` (feature `client`), tokio, and the napi glue only under the
default `node` feature. No workspace dependency, no path dependency, and
no dependency on `kernel-native`, `hiqlite-native`, or `toolchain`.
Unlike governance-native it needed no unbundling: it reached out of its
own directory for nothing, so the sources moved as they were.

Module map: `resources` (the pure builders for the placement shape),
`naming` (DNS-1123 validation, the reserved-namespace blocklist, derived
names and labels), `types` (the JSON boundary DTOs), `kube_ops` (the live
cluster I/O, feature-gated), `napi_api` (feature-gated delegators).

The crate keeps the three-layer build discipline it arrived with:
`crate-type` is `["cdylib", "rlib"]`, and `--no-default-features` compiles
out both the kube I/O layer and the napi layer, so the golden shape tests
run with no cluster and no Node C API. That is what makes a package whose
real job is talking to Kubernetes testable in a repository that has no
Kubernetes.

## 3. Behavior

### 3.1 License: AGPL-3.0, and why the shield holds

AGPL-3.0, with its own LICENSE file, which the package did not carry in
statecraft. It has one now.

The reasoning is spec 001 section 3's single question, and fleet-native
is its clearest case: no stamped customer app touches this package. Its
only consumer is statecraft's own `backend/fleet/`. The AGPL shield is a
SaaS shield, and orchestration is the thing a competitor would most want
to host without publishing. It stays AGPL-3.0; this move relicenses
nothing, and the Apache-2.0 root is a default, not a claim.

The dependency-direction invariant (spec 001 section 3.2) applies here
exactly as it does to governance-native: no Apache-2.0 package may depend
on this one. It is machine-checked by `scripts/check-licenses.mjs`, which
spec 005 section 3.3 specifies and which this package joins by declaring
its tier in the root manifest's `statecrafting.licenseTiers` map.

### 3.2 The napi surface

Five async JSON-in / JSON-out functions, unchanged from what statecraft
spec 006 section 2 specified and landed:

| Function | Contract |
|---|---|
| `placeApp(spec)` | create the full placement shape for one app |
| `appStatus(name, ns)` | read live status from `Deployment.status` |
| `updateApp(spec)` | image-ref change, Recreate rollout, wait for ready |
| `backupApp(name, ns, target)` | scale down, restic Job, scale back up |
| `removeApp(name, ns)` | tear the app's resources down |

Kubeconfig path or in-cluster config is resolved Rust-side; the TS layer
never opens the file. The placement shape (single-replica Recreate
Deployment, RWO PVC, ClusterIP Service, nginx Ingress with the
cert-manager DNS-01 issuer, per-tenant Namespace, baseline deny plus
allow-ingress-controller NetworkPolicies) and the backup mechanism
(scale-down plus ephemeral restic Job, forced by `hcloud-volumes` being
ReadWriteOnce single-attach) are statecraft spec 006 section 3's
decisions, verified against the live cluster. They move unchanged.

Two constants carried by this crate are wire constants, and renaming them
would break a running fleet: the `fleet.statecraft.ing/app` label that
identifies managed resources, and the `statecraft-system` entry in the
reserved-namespace blocklist. They stay as they are.

The inbound rename statecraft spec 006 section 3 recorded still holds and
is deliberately not touched here: the consumer passes its
`FLEET_S3_RESTIC_PASSWORD` value into the backup Job as restic's own
`RESTIC_PASSWORD` environment variable, because that is restic's CLI
contract.

### 3.3 Publishing

Joins the spec 002 publish matrix (`.github/workflows/publish.yml`) with
the same three napi legs plus the meta package, idempotent per version.
The napi bindings are on by default, so the build script passes no extra
feature flag.

## 4. Ownership: an edge transfer

statecraft spec 006 establishes two directories: `backend/fleet/` and
`addon/fleet-native/`. The second one moves here; the first stays, and so
does the spec.

| | |
|---|---|
| Edge that moves | `addon/fleet-native/` |
| Edges that stay | `backend/fleet/` |
| statecraft 006 status after | narrowed, **not retired** |

statecraft 006 is a whole service design and, uniquely among the five
exporting specs, a live operational record. It owns the FleetApp and
FleetOp entities and the intent journal, the five HTTP verbs, the
action-gate soft hook that made fleet the first governance consumer, the
operator prerequisites (kubeconfig location, `FLEET_BASE_DOMAIN`, the
Cloudflare zone and DNS-01 issuer, the backup bucket and credential
separation), the four findings from the 2026-07-15 live E2E and how three
were fixed, the 2026-07-16 E2E that passed on deployd.xyz, and the
deferred M3 ten-app scale check with its residuals. None of that is addon
territory and none of it moves.

That record is why the transfer discipline matters most here. A spec that
carries the only written account of why a production cluster is
configured the way it is cannot be treated as a wrapper around the code
that happened to leave. Its `establishes` list drops one entry and keeps
the other, in the same change that repoints its consumer at the published
package (section 5, acceptance item 3).

## 5. Acceptance

1. The pure builders build and test green under
   `cargo test --no-default-features` (no cluster, no napi, no Node C
   API): the 12 golden tests statecraft proved, covering the placement
   shape, the non-root securityContext with `fsGroup`, the optional image
   pull secret, the NetworkPolicy pair, the read-only restic backup Job,
   and DNS-1123 namespace validation. **Satisfied**: 12 passed on the
   first run here.
2. `@statecrafting/fleet-native` and its three platform packages publish
   at `0.1.0` with provenance, all declaring AGPL-3.0 with a LICENSE
   file.
3. statecraft builds against the published package: its root manifest
   depends on `@statecrafting/fleet-native` at a pinned version instead of
   `file:./addon/fleet-native`, its in-tree `addon/fleet-native/` is gone,
   spec 006 has dropped that edge and kept `backend/fleet/`, and its suite
   is green. Per spec 001 section 5 the package is not done until a
   consumer builds against it. **Satisfied 2026-07-20**
   (statecrafting/statecraft PR #42): statecraft pins `0.1.0`, `addon/` is
   gone from that tree, spec 006 establishes `backend/fleet/` alone and
   records the transfer in a dated status note that keeps its live-cluster
   history intact, and its gates are green (typecheck clean, vitest 111
   passed / 16 skipped, `build:app` against the published package, spine
   compile 11 specs / lint 0/0/0 / index fresh). The control-plane image
   also builds and pushes with no Rust toolchain at all, verified by a
   manual `image.yml` dispatch.
4. `scripts/check-licenses.mjs` passes, with this package declared
   AGPL-3.0 and no Apache-2.0 package depending on it.
5. Spine gates green: compile, index check, lint `--fail-on-warn`.

Re-running the live cluster E2E is explicitly not an acceptance item
here. statecraft spec 006 already holds it, this transfer changes no
resource shape, and the golden tests are what guard that. If the shapes
ever do change, the E2E belongs to whichever spec changes them.

## 6. Out of scope

- The `fleet/` Encore service and everything it owns: the entities, the
  intent journal, the endpoints, the gate integration, the operator
  prerequisites, the E2E record, and the deferred M3 scale check. That is
  statecraft spec 006 and it stays there.
- Autoscaling, multi-replica, multi-cluster, non-K8s targets; the
  image-building pipeline; Turso credential provisioning. All were
  already out of scope upstream and remain so.
- The no-downtime backup path (statecraft spec 006 section 3: it needs a
  snapshot-capable storage layer, a storage-architecture decision for a
  later spec, not a config flag).
- Any change to the addon's behavior, surface, or wire constants. This is
  a transfer.

## 7. The ladder closes

With this spec the spec 001 section 5 ladder is complete: toolchain
(002), hiqlite-native (003), kernel-native (004), governance-native (005),
fleet-native (006). Five packages, three licenses, one spine.

What spec 001 promised is now also enforced rather than described. The
licensing model (section 3) and the dependency-direction invariant
(section 3.2) are checked by `scripts/check-licenses.mjs` over a declared
tier map in the workspace manifest, on every pull request. Spec 001 said
the invariant was the one most likely to be violated by accident because
nothing in npm enforces it; something does now.

No exporting spec retired, which was spec 001 section 4's requirement and
the failure mode it recorded a live example of. All five kept the code
they still own.

## Amendment (2026-07-23): the ingress allow becomes per-app (0.2.0)

The transfer shipped the NetworkPolicy set exactly as statecraft spec 006
landed it: three namespace-scoped policies (`podSelector: {}`), applied
create-or-tolerate-409. One of them, `fleet-allow-ingress-nginx`, admits
the ingress controller on the deploying app's port. Both halves of that
design are individually reasonable and jointly wrong: the policy is
namespace-wide, but its port list comes from whichever app is placed into
the namespace first, and 409 tolerance means no later placement revises
it.

statecraft's in-pod two-stage fleet E2E (2026-07-23, the first run to
place two apps on two different ports in one tenant namespace) hit the
consequence: the first app (port 4000) pinned the namespace policy; the
second (port 8080) rolled out Ready, because kubelet probes bypass
NetworkPolicy, and served 502 from the edge. Green rollout, dead edge:
the same silent-failure class the port-injection fix killed one layer up.

0.2.0 makes the ingress allow per-app:

- `network_policies()` now emits `fleet-allow-ingress-<app>`
  (`naming::ingress_policy_name`) with a `podSelector` matching the app's
  selector labels and a port list of exactly the app's port, carrying the
  full per-app label set. The namespace-scoped `fleet-default-deny-all`
  and `fleet-allow-egress` are unchanged: one shared pair per tenant
  namespace.
- Distinct names mean a second placement cannot 409 into the first app's
  policy and inherit its port. Create-or-tolerate-409 stays correct for
  the per-app policy because the port is immutable per app on the deploy
  request contract (statecraft spec 006).
- `removeApp` deletes the app's ingress allow with the app's other
  per-app resources; the shared baseline pair still stays until a
  last-app namespace GC exists.

Migration: nothing deletes a pre-0.2.0 namespace-wide
`fleet-allow-ingress-nginx`. NetworkPolicies are additive, so leaving it
in place breaks nothing placed under 0.2.0, but it keeps admitting its
frozen ports namespace-wide; the operator deletes it from a tenant
namespace once no app placed under 0.1.0 remains there. In the live
fleet that is one namespace, currently app-empty.

The golden suite guarding acceptance item 1 grows from 12 to 13 tests
with a two-apps-two-ports regression test; the resource shapes changed
here, so per section 5's closing rule the next live E2E belongs to this
amendment's consumer bump, not to the transfer record.

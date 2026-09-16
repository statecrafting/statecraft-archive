# Implementation Plan: Platform metrics stack (Prometheus + Grafana)

**Branch**: `196-platform-metrics-stack` | **Date**: 2026-06-03 | **Spec**: [`spec.md`](./spec.md)
**Input**: Feature specification from `specs/196-platform-metrics-stack/spec.md`

## Summary

Stand up a single `kube-prometheus-stack` Flux `HelmRelease` (Prometheus server
with `--web.enable-remote-write-receiver`, Grafana, node-exporter,
kube-state-metrics; Alertmanager disabled) that **receives** statecraft's Encore
`remote_write`, **scrapes** the already-annotated deployd-api/Flux/ingress
targets, and **serves** Grafana behind Rauthy OIDC. Operator-facing,
control-plane only — no per-project/tenant granularity (that is spec 175, at the
application layer). Phasing is **single-spec, sequenced**: a self-contained data
plane lands first; Grafana + its manually-created OIDC client land second as one
atomic phase.

## Technical Context

**Runtime**: Kubernetes (Hetzner k3s prod; Azure AKS dev — deferred per FR-009)
**Deploy mechanism**: Flux v2 `HelmRelease` + `HelmRepository` (spec 151), reconciled like the existing infra releases — no imperative `helm`
**Chart**: `kube-prometheus-stack` (prometheus-community), version pinned in the HelmRelease
**Metrics ingestion**: hybrid — Encore `remote_write` (push) + Prometheus scrape (pull). Encore's `prometheus` exporter has only `type`/`collection_interval`/`remote_write_url` and no auth field, so the receiver is reachable **only** over an in-cluster NetworkPolicy flow, never at ingress
**Identity**: Rauthy OIDC (spec 106), runtime dependency only. Grafana's OIDC **client is created manually** in the Rauthy admin UI per the documented `[manual]` convention (`platform/infra/hetzner/.env.example`) — 196 does not touch `seed-rauthy.mjs`
**Persistence**: PVCs for Prometheus TSDB + Grafana state
**Testing**: post-deploy success criteria SC-001…SC-007 (operator-observable: series present, scrape targets up, OIDC role mapping, default-deny intact, Alertmanager absent + rules pruned)

## Constitution Check

- **Spec-first (III)** — spec.md authored and locked before any chart/gitops file is created (CONST-005); this plan descends from it. ✓
- **Markdown truth / compiler JSON (I, II)** — the spec is markdown; the HelmRelease/NetworkPolicy/values are *deployment manifests* (machine config), not authored platform truth, so they are not a standalone-YAML-authoring violation. ✓
- **Spec/code coherence (CONST-005)** — 196 owns its forward paths via `establishes`/`refines` (declared at implementation per V-023); no drift engineered. ✓
- **No new identity-subsystem ownership** — Grafana client is manual; 196 carries no `seed-rauthy.mjs` edge, hence no co-authorship/collision surface. ✓

## Project Structure

```text
specs/196-platform-metrics-stack/
├── spec.md            # locked contract
├── plan.md            # this file
└── tasks.md           # NOT created here (separate step)

# Created at IMPLEMENTATION (establishes/refines edges land then, per V-023):
platform/gitops/clusters/hetzner-prod/infrastructure/monitoring.yaml      # HelmRepository + HelmRelease (establishes)
platform/k8s/policies/monitoring/networkpolicy-monitoring.yaml            # monitoring-ns ingress (establishes)
platform/k8s/policies/namespace-baseline/networkpolicy-allow-metrics-egress.yaml  # statecraft-system egress (establishes)
platform/services/statecraft/infra.config.hetzner.json                   # + metrics block (refines)
platform/services/statecraft/infra.config.json                           # Azure: stays null, FR-009 (refines)
```

**Structure Decision**: deployment artifacts live where the existing
control-plane lives — gitops infrastructure for the HelmRelease (mirrors
reflector/cert-manager/ingress-nginx/rauthy), `k8s/policies/` for the
NetworkPolicies, and the statecraft `infra.config` for the Encore metrics block.
Grafana's OIDC + dashboard config is HelmRelease `values`, owned by 196.

## Phasing — single-spec, sequenced

**Phase 1 — data plane (no UI, no auth surface).** Implements FR-001, FR-002,
FR-003, FR-005, FR-006, FR-007, FR-010, FR-011 (and FR-009's *declaration*).
- HelmRelease: Prometheus server + node-exporter + kube-state-metrics, remote-write receiver on, Alertmanager **disabled** + bundled rules pruned (FR-008), retention/PVC per defaults below.
- Scrape config for deployd-api / Flux / ingress-nginx (FR-003).
- `infra.config.hetzner.json` gains the `metrics` block → literal in-cluster `remote_write_url` (FR-001).
- The two additive NetworkPolicy objects across `statecraft-system` + `monitoring` (FR-006).
- **Exit:** SC-001 (statecraft series present), SC-002 (scrape targets up), SC-005 (default-deny intact), SC-006 (Alertmanager absent + rules pruned), SC-007 (Flux-reconciled, CRDs pinned, PVC-bounded), **SC-008 receiver-isolation** (the remote_write NetworkPolicies land in Phase 1, so the unauthenticated receiver is verified-isolated before Phase 2 layers on).

**Phase 2 — Grafana + OIDC (atomic).** Implements FR-004. **Must be one phase**:
SC-003 forbids a local Grafana password, so Grafana cannot come up before its
OIDC client exists.
- **Manual step (operator):** create the `grafana` OIDC client in the Rauthy admin UI (redirect `https://grafana.<DOMAIN>/login/generic_oauth`, `authorization_code`), capture `GRAFANA_OIDC_CLIENT_ID`/`_SECRET` into the env/secret set (the implementation PR adds these as `[manual]` stub entries in `platform/infra/hetzner/.env.example`, alongside the existing `OIDC_*`/`RAUTHY_CLIENT_*` placeholders), re-run `setup.sh` — exactly the documented `[manual]` OIDC-client flow.
- **HelmRelease values (196-owned):** Grafana `generic_oauth` with `client_id`/`client_secret`/issuer + `role_attribute_path` mapping the Rauthy `platform_role` claim → Grafana role (`owner`/`admin` → **Admin**, `member` → **Viewer**; the locked FR-004 map, `Editor` unused — **not** a Rauthy "groups" array); **Grafana configured OIDC-only per FR-004's property** — every non-OIDC auth path disabled (`disable_login_form`, `basic_enabled`, `anonymous.enabled`, `oauth_auto_login`, default-admin disabled, + proxy/JWT/API-key/service-account). **FR-004 is the authoritative knob set; this plan does not re-enumerate it** (avoids spec/plan drift). Grafana ingress at `grafana.<DOMAIN>`; the Grafana ingress NetworkPolicy.
- **Exit:** SC-003 (`platform_role`→role mapping verified + OIDC-only auth confirmed by a negative non-OIDC probe returning 401/403), SC-004 (`git diff` shows the only `platform/services/statecraft/**` change is the `infra.config.hetzner.json` metrics block — service-wide, not `api/**`-only), **SC-009 Grafana-port isolation**, **SC-010 end-to-end visibility** (the SC-001-recorded statecraft series renders in a Grafana panel) — Grafana + its ingress land here.

Phase 1 is independent and can land alone; Phase 2 depends only on Phase 1 (the
stack must exist) plus the manual client.

## Concrete values (proposed)

- **Grafana host**: `grafana.<DOMAIN>` (follows the `auth.`/`statecraft.` convention; `<DOMAIN>` from `.env.example`)
- **OIDC client_id**: `grafana`
- **redirect_uri**: `https://grafana.<DOMAIN>/login/generic_oauth`
- **Prometheus retention**: `15d`, TSDB PVC `20Gi` *(tunable; pre-alpha single-cluster default; revisit at the FR-009 promotion trigger per FR-010)*
- **Grafana PVC**: `2Gi` *(dashboards provisioned as code; state only)*
- **Encore `collection_interval`**: `60s` — bounds remote_write volume; never sub-`15s` (FR-001)

## Access-policy decision — RESOLVED (owner, 2026-06-04)

- **`platform_role` → Grafana-role map.** **Locked:** the Rauthy `platform_role`
  claim (spec 106 Principle 2; values `owner`/`admin`/`member`, per
  `seed-rauthy.mjs:77`) maps `owner` **and** `admin` → Grafana **Admin**,
  `member` → **Viewer**. Grafana's `Editor` role is unused. This decides who
  holds Admin on the observability plane: anyone with platform owner/admin.
- **Vocabulary correction.** An earlier draft proposed inventing the groups
  `platform-admin` → Admin / `platform-operator` → Editor / others → Viewer.
  Those names do **not** exist in the identity model — OAP drives roles through
  the scope-driven `platform_role` claim, not a Rauthy "groups" array, and there
  is no `operator`/`viewer`/`editor` vocabulary. The invented names have been
  corrected throughout 196 (FR-004, SC-003, User Story 3).
- **Phase-2 verifiability.** With the map locked, SC-003 is verifiable at Phase 2
  with no pending precondition; it no longer "does not ride inside the
  implementation PR."

## Complexity Tracking

| Item | Why needed | Note |
|------|-----------|------|
| Prometheus Operator CRDs (cluster-wide) | kube-prometheus-stack ships them; `ServiceMonitor`/`PrometheusRule` are the declarative GitOps fit | New governed dependency surface (FR-007); version pinned in the HelmRelease |
| Unauthenticated remote_write receiver | Encore's exporter has no auth field | Contained by NetworkPolicy (FR-006); never exposed at ingress |

## Out of scope (this plan)

- `tasks.md` (separate step), alerting/SLO rules (later spec), logs + tracing
  pillars (later specs), Azure implementation (FR-009 deferred-null).
- **Deferred to `tasks.md` / implementation tuning** (long-tail hardening, not
  contract bugs): per-component CPU/memory requests+limits for the stack
  (prometheus-server, grafana, kube-state-metrics, node-exporter DaemonSet),
  revisited at the FR-009/FR-010 trigger; and declaring `collection_interval`
  explicitly in the metrics block (not relying on the Encore default) so SC-007's
  guard cannot silently pass on a changed default.

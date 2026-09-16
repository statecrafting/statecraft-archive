# Spec 136 — Execution verification

> Per spec 005-verification-reconciliation-mvp. Captures the
> live-cluster evidence for **T023** (Phase 2 happy path) and
> **T030/T031** (Phase 3 negative-path validation) against the
> Hetzner K3s dev cluster on **2026-05-17**.

## Cluster and tooling baseline

- **Cluster**: Hetzner K3s `v1.31.4+k3s1`, two nodes
  (`oap-hetzner-master1` + `oap-hetzner-pool-worker-worker1`).
- **kubeconfig**: `platform/infra/hetzner/kubeconfig`.
- **Chart**: `platform/charts/tenant-hello@0.1.0` (deployed via local
  `helm` shell-out, mirroring `deployd-api-rs::helm::HelmRunner`'s
  invocation shape — same chart bytes, same value overrides).
- **Image**: `ghcr.io/statecrafting/open-agentic-platform/tenant-hello:latest`
  published by `cd-tenant-hello.yml` workflow_dispatch run
  [25987117916](https://github.com/statecrafting/open-agentic-platform/actions/runs/25987117916)
  (39 s build, source = main @ `b3c0ddcf`).
- **Test namespace**: `tenant-hello-test` (created + destroyed
  per-pass; one pod, no shared state). Image pull via copied
  `ghcr-credentials` secret from `statecraft-system`.

## T023 — End-to-end happy path *(Phase 2 SC-002 positive half)*

### Install

```
helm install tenant-hello-t023 platform/charts/tenant-hello \
  --namespace tenant-hello-test \
  --set image.repository=ghcr.io/statecrafting/open-agentic-platform/tenant-hello \
  --set image.tag=latest \
  --set 'imagePullSecrets[0].name=ghcr-credentials' \
  --wait --timeout=2m
```

Result: `STATUS: deployed`, helm `--wait` returned after the
readiness probe passed (pod transitioned to `1/1 Running`).

### Pod state

```
NAME                                 READY   STATUS    RESTARTS   AGE
tenant-hello-t023-54dc9d456b-7ls7k   1/1     Running   0          26s
```

Probe configuration (from `kubectl describe pod`):

```
Liveness:   http-get http://:http/healthz delay=15s timeout=3s period=20s
Readiness:  http-get http://:http/healthz delay=3s timeout=3s period=10s
```

### `/healthz` and `/` over port-forward

```
$ kubectl -n tenant-hello-test port-forward svc/tenant-hello-t023 18080:8080 &
$ curl http://127.0.0.1:18080/healthz
ok
HTTP 200

$ curl http://127.0.0.1:18080/
{"ok":true,"service":"tenant-hello","ts":"2026-05-17T09:31:39.708Z"}
HTTP 200
```

### Mapping to ACs

| Anchor | Evidence | Status |
|---|---|---|
| FR-002 (`/healthz` returns 200 + non-empty body) | `ok` body, HTTP 200 | ✅ |
| FR-002 (JSON root identifies service) | `{"ok":true,"service":"tenant-hello",...}` | ✅ |
| FR-003 (binds to `PORT` env var) | service port 8080, container listens 8080 | ✅ |
| C-002 (readiness probe on `/healthz`) | probe target `/healthz`, pod `1/1 Running` | ✅ |
| SC-002 first half (deploys a running pod whose `/healthz` returns 200) | both lines above | ✅ |

## T030/T031 — Negative-path validation *(Phase 3 SC-002 negative half)*

Each pass deploys a tenant image that violates one C-clause through
the same chart, with the same overrides, and the failure mode is
captured. Localised failure is the bar: the operator can name **which
clause** and **what about the image** broke the contract from the
event/log surface alone, without reading platform internals.

### Pass 1 — C-001 violation (privileged image: `nginx:alpine`)

`nginx:alpine` ships as a default-root, writable-rootfs image. The
chart's `podSecurityContext.runAsUser=10001` /
`containerSecurityContext.readOnlyRootFilesystem=true` are the
C-001 enforcement edge.

```
helm install tenant-c001-violation platform/charts/tenant-hello \
  --namespace tenant-hello-test \
  --set image.repository=nginx --set image.tag=alpine
```

Container logs (terminated state):

```
[warn] the "user" directive makes sense only if the master process
       runs with super-user privileges, ignored in /etc/nginx/nginx.conf:2
[emerg] mkdir() "/var/cache/nginx/client_temp" failed (30: Read-only file system)
```

Pod settled in `CrashLoopBackOff` (restartCount=3, exitCode=1,
reason=`Error`). Helm reports `STATUS: failed — resource
Deployment/tenant-c001-violation-tenant-hello not ready`.

**Localised signal:** the log cites the specific path
(`/var/cache/nginx/client_temp`) the image tried to write to under
the chart's read-only-rootfs invariant. The image's `nginx.conf:2`
`user` directive is also flagged as ignored because the chart denies
super-user privileges. An operator reading this knows: the tenant
image violates C-001 (privileged + writable filesystem
expectations); the chart correctly refused to relax the security
context.

### Pass 2 — C-002 violation (no `/healthz` route: `nginxinc/nginx-unprivileged:alpine`)

`nginx-unprivileged` clears C-001 (non-root, binds 8080) but its
default config only serves `/` — no `/healthz`. The chart's readiness
probe at `/healthz` is the C-002 enforcement edge.

```
helm install tenant-c002-violation platform/charts/tenant-hello \
  --namespace tenant-hello-test \
  --set image.repository=nginxinc/nginx-unprivileged --set image.tag=alpine \
  --set 'podSecurityContext.runAsUser=101' \
  --set 'containerSecurityContext.readOnlyRootFilesystem=false'
```

Pod events:

```
Warning  Unhealthy  3s (x4 over 33s)  kubelet  Readiness probe failed: HTTP probe failed with statuscode: 404
Warning  Unhealthy  3s (x2 over 23s)  kubelet  Liveness probe failed: HTTP probe failed with statuscode: 404
```

Pod stays at `0/1 Running` indefinitely (never becomes `Ready`).
Helm reports `STATUS: failed — Available: 0/1`.

**Localised signal:** the probe target (`/healthz`) and the HTTP
status (`404`) appear in every probe-failure event. The tenant
image responds to the request — connection is up — but the
specific path the readiness probe requires returns Not Found. An
operator reading this knows: tenant image violates C-002 (does not
expose `/healthz`).

### Pass 3 — C-003 violation (tenant ignores `PORT`: `hashicorp/http-echo`)

`hashicorp/http-echo` hardcodes its listen port (default 5678).
Setting the chart's `service.port=9090` instructs the chart to inject
`PORT=9090` and probe `:9090`, while the image binds to 5678 →
connection refused. The chart's `PORT` env injection + probe
targeting are the C-003 enforcement edge.

```
helm install tenant-c003-violation platform/charts/tenant-hello \
  --namespace tenant-hello-test \
  --set image.repository=hashicorp/http-echo --set image.tag=latest \
  --set 'service.port=9090' \
  --set 'containerSecurityContext.readOnlyRootFilesystem=false'
```

Pod events:

```
Warning  Unhealthy  13s               kubelet  Liveness probe failed: Get "http://10.244.1.188:9090/healthz": dial tcp 10.244.1.188:9090: connect: connection refused
Warning  Unhealthy  3s (x3 over 23s)  kubelet  Readiness probe failed: Get "http://10.244.1.188:9090/healthz": dial tcp 10.244.1.188:9090: connect: connection refused
```

Pod stays at `0/1 Running`. Helm reports `STATUS: failed —
Available: 0/1`.

**Localised signal:** both probe events name the target
(`http://<pod-ip>:9090/healthz`) and the symptom
(`connect: connection refused`). The TCP connection itself is
refused — the image is not listening on the port the platform
injected via `PORT`. An operator reading this knows: tenant image
violates C-003 (does not honour `PORT` env var).

### Negative-path summary

| Pass | C-clause | Image | Localised signal |
|---|---|---|---|
| 1 | C-001 (non-privileged, ephemeral fs) | `nginx:alpine` | `mkdir() ".../client_temp" failed (30: Read-only file system)` + `"user" directive ... ignored` |
| 2 | C-002 (`/healthz` returns 200) | `nginxinc/nginx-unprivileged:alpine` | Probe events cite `/healthz` path + HTTP `404` |
| 3 | C-003 (binds to `PORT` env) | `hashicorp/http-echo` | Probe events cite target `:9090/healthz` + `connection refused` |

Each pass:
- Fails the deploy (helm `--wait` times out; release `STATUS: failed`).
- Surfaces the offending C-clause through the standard kubelet probe
  + container-log surfaces — no platform-specific decoding needed.
- Leaves a release the operator can `helm uninstall` cleanly. No
  resource leaks beyond the failed Deployment, which `helm uninstall`
  removes.

This evidences the SC-002 negative half: "the same pipeline run
against a codebase that violates one of C-001…C-005 fails with a
localised error, not a generic platform crash."

## Cleanup

After every pass:

```
helm -n tenant-hello-test uninstall <release>
kubectl delete namespace tenant-hello-test
```

Cluster state at end of the run: namespace deleted; no orphaned
resources in `statecraft-system`, `deployd-system`, `rauthy-system`.

## Reproduction notes

- The CD workflow `cd-tenant-hello.yml` is the canonical image
  source; subsequent verification runs should re-tag from
  `:latest` or pin to a `sha-<short>` once a specific image is
  the subject of an incident.
- The chart was deployed via the local `helm` CLI here rather than
  via `deployd-api-rs::helm::install`. Both code paths embed/use
  the same `Chart.yaml` and template tree (`include_str!` in
  `platform/services/deployd-api-rs/src/helm.rs` vs.
  `platform/charts/tenant-hello/` on disk); the values mapping is
  the same shape. A future spec 136 follow-up may re-run T023 via
  `POST /v1/deployments` end-to-end through deployd-api once a
  statecraft project is bound to tenant-hello, but the chart
  contract verified here is the same contract deployd-api would
  apply.

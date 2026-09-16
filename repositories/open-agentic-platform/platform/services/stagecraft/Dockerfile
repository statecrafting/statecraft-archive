# Fast hotfix image for statecraft (minimal-swap variant).
#
# Empirically, the encore runtime fails with "no api server or gateway
# to serve" when only `main.mjs` + `/encore/meta` are reused but
# `node_modules`, source tree, etc. are rebuilt from the working tree
# — even when the bundle structure matches byte-for-byte. The only
# reliable manual hotfix path is to start FROM the previously-published
# image (which ships a known-good runtime/meta/node_modules trio) and
# overlay only the freshly-compiled `main.mjs` (which carries the
# code-level fix).
#
# This is sufficient for SOURCE bug fixes — the encore bundle imports
# every service implementation into a single main.mjs, so any change
# under `api/**` is reflected in the new bundle. It is NOT sufficient
# for changes that affect:
#   - service shape (new endpoint, request/response type changes,
#     new service, new gateway) — those need fresh `/encore/meta`,
#     produced by a full `encore build docker`
#   - dependencies (`package.json`, `package-lock.json`) — those need
#     fresh `node_modules`
#   - frontend assets under `web/build/`
#   - infra config (`infra.config.hetzner.json`)
# For any of those, fall back to `make docker-build-hetzner` (the slow
# but supported encore-built path).
#
# Build inputs (staged by `scripts/docker-build.sh`):
#   .encore/build/combined/combined/main.mjs(.map)
#                       — produced by a brief, cancelled
#                         `encore build docker` against the
#                         working tree
#
# Bump PREV_IMAGE only when the encore CLI version, the encore.dev npm
# version, or the service surface (endpoints / types / services)
# changes; that's when a fresh meta + matching `node_modules` are
# required and the supported builder must run a full pass.

ARG PREV_IMAGE=ghcr.io/statecrafting/open-agentic-platform/statecraft:sha-63bc488

FROM ${PREV_IMAGE}

USER 0:0
COPY .encore/build/combined/combined/main.mjs       /workspace/platform/services/statecraft/.encore/build/combined/combined/main.mjs
COPY .encore/build/combined/combined/main.mjs.map   /workspace/platform/services/statecraft/.encore/build/combined/combined/main.mjs.map
# react-router build output — main.mjs references hashed asset paths
# (e.g. /assets/_index-y00VqT4i.js) that move every rebuild, so the
# server bundle and the static client tree must ship together.
COPY web/build /workspace/platform/services/statecraft/web/build
RUN chown -R 10001:10001 \
      /workspace/platform/services/statecraft/.encore/build/combined/combined/main.mjs \
      /workspace/platform/services/statecraft/.encore/build/combined/combined/main.mjs.map \
      /workspace/platform/services/statecraft/web/build
USER 10001:10001

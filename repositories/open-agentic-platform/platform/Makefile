# OAP Platform — Multi-Target Deployment
# Usage: make deploy TARGET=azure|aws|gcp|do|hetzner

TARGET ?= azure
ENV    ?= dev

# --- Directory layout ---
TF_ROOT      = infra/terraform
TF_MODULES   = $(TF_ROOT)/modules
CHARTS_ROOT  = charts
HETZNER_ROOT = infra/hetzner
# Operator kubeconfig lives outside the repo tree (see infra/hetzner/setup.sh).
OAP_HETZNER_DIR ?= $(HOME)/.config/oap/infra/hetzner

# --- Terraform env paths (cloud targets) ---
TF_CORE    = $(TF_ROOT)/envs/$(ENV)/core
TF_CLUSTER = $(TF_ROOT)/envs/$(ENV)/cluster

# ============================================================
# Top-level targets
# ============================================================

.PHONY: deploy destroy bootstrap info

deploy:
	@$(MAKE) deploy-$(TARGET)

destroy:
	@$(MAKE) destroy-$(TARGET)

bootstrap:
	@$(MAKE) bootstrap-$(TARGET)

info:
	@echo "TARGET=$(TARGET)  ENV=$(ENV)"
	@echo "TF_CORE=$(TF_CORE)"
	@echo "TF_CLUSTER=$(TF_CLUSTER)"

# ============================================================
# Azure
# ============================================================

.PHONY: deploy-azure destroy-azure

tf-init:
	cd $(TF_CORE) && terraform init
	cd $(TF_CLUSTER) && terraform init

docker-push-azure:
	az acr login -n statecraftdevacr
	cd services/deployd-api-rs && docker build -t statecraftdevacr.azurecr.io/deployd-api:dev . && docker push statecraftdevacr.azurecr.io/deployd-api:dev
	# `encore build docker` packages whatever is on disk under web/build/;
	# regenerate the react-router client tree first so bundled main.mjs and
	# the static client tree share matching hashed asset names.
	cd services/statecraft && npm run build:frontend
	cd services/statecraft && encore build docker --config ./infra.config.json statecraftdevacr.azurecr.io/statecraft:dev && docker push statecraftdevacr.azurecr.io/statecraft:dev

deploy-azure: tf-init
	cd $(TF_CORE) && terraform apply -auto-approve
	$(MAKE) docker-push-azure
	cd $(TF_CLUSTER) && terraform apply -auto-approve \
		-target=module.cluster_addons.helm_release.cert_manager \
		-target=module.cluster_addons.helm_release.ingress_nginx \
		-target=module.cluster_addons.helm_release.external_secrets \
		-target=module.cluster_addons.time_sleep.wait_for_cert_manager_crds
	cd $(TF_CLUSTER) && terraform apply -auto-approve

destroy-azure:
	cd $(TF_CLUSTER) && terraform destroy -auto-approve
	cd $(TF_CORE) && terraform destroy -auto-approve
	az network watcher configure --enabled false --locations canadacentral
	az group delete --name NetworkWatcherRG --yes --no-wait
	az group delete --name statecraft-dev-rg --yes --no-wait

# ============================================================
# AWS
# ============================================================

.PHONY: deploy-aws destroy-aws

deploy-aws:
	cd $(TF_ROOT)/envs/aws-$(ENV)/core && terraform init && terraform apply -auto-approve
	cd $(TF_ROOT)/envs/aws-$(ENV)/cluster && terraform init && terraform apply -auto-approve

destroy-aws:
	cd $(TF_ROOT)/envs/aws-$(ENV)/cluster && terraform destroy -auto-approve
	cd $(TF_ROOT)/envs/aws-$(ENV)/core && terraform destroy -auto-approve

# ============================================================
# GCP
# ============================================================

.PHONY: deploy-gcp destroy-gcp

deploy-gcp:
	cd $(TF_ROOT)/envs/gcp-$(ENV)/core && terraform init && terraform apply -auto-approve
	cd $(TF_ROOT)/envs/gcp-$(ENV)/cluster && terraform init && terraform apply -auto-approve

destroy-gcp:
	cd $(TF_ROOT)/envs/gcp-$(ENV)/cluster && terraform destroy -auto-approve
	cd $(TF_ROOT)/envs/gcp-$(ENV)/core && terraform destroy -auto-approve

# ============================================================
# DigitalOcean
# ============================================================

.PHONY: deploy-do destroy-do

deploy-do:
	cd $(TF_ROOT)/envs/do-$(ENV)/core && terraform init && terraform apply -auto-approve
	cd $(TF_ROOT)/envs/do-$(ENV)/cluster && terraform init && terraform apply -auto-approve

destroy-do:
	cd $(TF_ROOT)/envs/do-$(ENV)/cluster && terraform destroy -auto-approve
	cd $(TF_ROOT)/envs/do-$(ENV)/core && terraform destroy -auto-approve

# ============================================================
# Hetzner K3s
# ============================================================

.PHONY: deploy-hetzner destroy-hetzner bootstrap-hetzner

bootstrap-hetzner:
	@echo "==> Running Hetzner setup..."
	$(HETZNER_ROOT)/setup.sh

## tag: rauthy-deploy
deploy-hetzner:
	# Spec 151 Phase 4 — rauthy moved to Flux
	# (`platform/gitops/clusters/hetzner-prod/infrastructure/rauthy.yaml`).
	# The previous `helm upgrade --install rauthy ...` invocation retired
	# here to eliminate the dual-writer hazard against the HelmRelease.
	# statecraft + deployd-api blocks below stay imperative until spec 152
	# migrates them.
	KUBECONFIG=$(OAP_HETZNER_DIR)/kubeconfig helm upgrade --install statecraft $(CHARTS_ROOT)/statecraft \
		--namespace statecraft-system \
		-f $(CHARTS_ROOT)/statecraft/values.yaml \
		-f $(CHARTS_ROOT)/statecraft/values-hetzner.yaml \
		--wait --timeout 300s
	KUBECONFIG=$(OAP_HETZNER_DIR)/kubeconfig helm upgrade --install deployd-api $(CHARTS_ROOT)/deployd-api \
		--namespace deployd-system \
		-f $(CHARTS_ROOT)/deployd-api/values.yaml \
		-f $(CHARTS_ROOT)/deployd-api/values-hetzner.yaml \
		--wait --timeout 300s

# GHCR namespace owned by the GitHub org that hosts this repo. The
# `-hetzner` targets push the images that values-hetzner.yaml pulls,
# i.e. ghcr.io/statecrafting/open-agentic-platform/{deployd-api,statecraft}.
HETZNER_REGISTRY ?= ghcr.io/statecrafting/open-agentic-platform

docker-build-hetzner:
	cd services/deployd-api-rs && docker build -t $(HETZNER_REGISTRY)/deployd-api:latest .
	# `encore build docker` packages whatever is on disk under web/build/;
	# it does not run npm scripts. Regenerate the react-router client tree
	# first so the bundled main.mjs and the static client tree are pinned
	# to the same hashed asset names. Skipping this ships stale frontend
	# and breaks hydration (observed 2026-05-07 hotfix attempt).
	cd services/statecraft && npm run build:frontend
	cd services/statecraft && encore build docker --config ./infra.config.json $(HETZNER_REGISTRY)/statecraft:latest

docker-push-hetzner: docker-build-hetzner
	docker push $(HETZNER_REGISTRY)/deployd-api:latest
	docker push $(HETZNER_REGISTRY)/statecraft:latest

# ============================================================
# Hetzner — fast docker build (cancel-then-scrape)
# ============================================================
# `encore build docker` is pathologically slow on macOS (single-threaded
# go-containerregistry gzip compression of the bundled source layer
# routinely takes 15+ min for ~200 MB images). The fast path documented
# at services/statecraft/docs/encore-custom-dockerfile.md cancels the
# encore build once main.mjs is on disk and feeds it into a hand-rolled
# Dockerfile via services/statecraft/scripts/docker-build.sh — typical
# total time 30–60s.
#
# STATECRAFT_TAG controls the resulting tag. Defaults to ":latest"; set
# to a SHA / hotfix marker for traceable hotfix deploys, e.g.
#   make docker-push-hetzner-fast STATECRAFT_TAG=hotfix-2026-05-07-knowledge-list
STATECRAFT_TAG ?= latest
STATECRAFT_ARCH ?= amd64

docker-build-statecraft-fast:
	cd services/statecraft && ./scripts/docker-build.sh \
		$(HETZNER_REGISTRY)/statecraft:$(STATECRAFT_TAG) \
		--arch $(STATECRAFT_ARCH)

docker-push-statecraft-fast: docker-build-statecraft-fast
	docker push $(HETZNER_REGISTRY)/statecraft:$(STATECRAFT_TAG)

docker-build-hetzner-fast:
	cd services/deployd-api-rs && docker build -t $(HETZNER_REGISTRY)/deployd-api:latest .
	$(MAKE) docker-build-statecraft-fast

docker-push-hetzner-fast: docker-build-hetzner-fast
	docker push $(HETZNER_REGISTRY)/deployd-api:latest
	docker push $(HETZNER_REGISTRY)/statecraft:$(STATECRAFT_TAG)

destroy-hetzner:
	hetzner-k3s delete --config $(HETZNER_ROOT)/cluster.yaml

# ============================================================
# Hetzner — local dev loop via mirrord
# ============================================================
# Prereqs: curl -fsSL https://raw.githubusercontent.com/metalbear-co/mirrord/main/scripts/install.sh | bash
# Inbound traffic to the cluster ingress is stolen into the local process.
# Ctrl-C restores the pod as the traffic target.

.PHONY: dev-statecraft-hetzner dev-statecraft-web-hetzner dev-deployd-api-hetzner

# Mirrord's http_filter (see infra/hetzner/mirrord/statecraft.yaml) only
# steals requests carrying `x-statecraft-dev: 1`, which vite injects on
# every proxied request. That keeps k8s liveness probes on the pod and
# stops them from killing the target during Encore startup.
#
# DEV_APP_BASE_URL drives the OAuth/OIDC redirect_uri. Default it to the
# HMR origin so the localhost:3000 flow works out of the box; override
# with `DEV_APP_BASE_URL=... make dev-statecraft-hetzner` if you want a
# different origin (or unset it to fall back to the pod's APP_BASE_URL).
dev-statecraft-hetzner: export DEV_APP_BASE_URL ?= http://localhost:3000
dev-statecraft-hetzner:
	@command -v mirrord >/dev/null 2>&1 || { echo "mirrord not found. Install: curl -fsSL https://raw.githubusercontent.com/metalbear-co/mirrord/main/scripts/install.sh | bash"; exit 1; }
	cd services/statecraft && npm install --silent
	$(HETZNER_ROOT)/mirrord/statecraft-compile.sh
	set -a && . $(HETZNER_ROOT)/mirrord/.statecraft.env && set +a && \
	KUBECONFIG=$(OAP_HETZNER_DIR)/kubeconfig \
	mirrord exec -f $(HETZNER_ROOT)/mirrord/statecraft.yaml -- \
		node services/statecraft/.encore/build/combined/combined/main.mjs

# React Router dev server on :3000 with HMR, proxying Encore-owned paths to
# the mirrord'd backend on :4000. Run `dev-statecraft-hetzner` in another
# terminal first so the Encore backend is listening.
dev-statecraft-web-hetzner:
	@command -v node >/dev/null 2>&1 || { echo "node not found. Install Node.js 20+"; exit 1; }
	cd services/statecraft && npm install --silent
	cd services/statecraft && npm run gen
	cd services/statecraft/web && ENCORE_API_BASE_URL=http://localhost:4000 npx react-router dev

dev-deployd-api-hetzner:
	@command -v mirrord >/dev/null 2>&1 || { echo "mirrord not found. Install: curl -fsSL https://raw.githubusercontent.com/metalbear-co/mirrord/main/scripts/install.sh | bash"; exit 1; }
	KUBECONFIG=$(OAP_HETZNER_DIR)/kubeconfig \
	mirrord exec -f $(HETZNER_ROOT)/mirrord/deployd-api.yaml -- \
		cargo run --manifest-path services/deployd-api-rs/Cargo.toml

# ============================================================
# Docker build (generic — push to any registry)
# ============================================================

.PHONY: docker-build docker-push

REGISTRY ?= ghcr.io/open-agentic-platform

docker-build:
	cd services/deployd-api && docker build -t $(REGISTRY)/deployd-api:dev .
	# `encore build docker` packages whatever is on disk under web/build/;
	# regenerate the react-router client tree first so bundled main.mjs and
	# the static client tree share matching hashed asset names.
	cd services/statecraft && npm run build:frontend
	cd services/statecraft && encore build docker --config ./infra.config.json $(REGISTRY)/statecraft:dev

docker-push: docker-build
	docker push $(REGISTRY)/deployd-api:dev
	docker push $(REGISTRY)/statecraft:dev

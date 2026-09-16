#!/usr/bin/env bash
# Builds the backend container image: a custom base (Dockerfile.base) plus the
# Encore-compiled application bundle (`encore build docker --base`). Spec 001.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_NAME="${IMAGE_NAME:-vue-encore-enterprise-template-api}"
BASE_TAG="${IMAGE_NAME}-base:latest"

echo "==> building base image (${BASE_TAG})"
docker build -f Dockerfile.base -t "${BASE_TAG}" .

echo "==> building application image (${IMAGE_NAME}:latest) on the custom base"
encore build docker --config infra.config.json --base "${BASE_TAG}" "${IMAGE_NAME}:latest"

echo "==> done: ${IMAGE_NAME}:latest"

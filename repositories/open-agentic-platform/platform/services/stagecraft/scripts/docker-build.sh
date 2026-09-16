#!/usr/bin/env bash
set -euo pipefail

# Fast docker build for statecraft via the cancel-then-scrape technique
# documented in docs/encore-custom-dockerfile.md. The companion
# Dockerfile is "minimal-swap": it starts FROM a previously-published
# image and overlays only the freshly-bundled main.mjs. See the
# Dockerfile preamble for the complete list of changes that this path
# does NOT cover (service surface changes, dep bumps, frontend asset
# changes, infra config changes — fall back to encore build docker for
# any of those).
#
# Usage:
#   ./scripts/docker-build.sh [IMAGE_TAG] [--arch amd64|arm64]
#
# Examples:
#   ./scripts/docker-build.sh ghcr.io/.../statecraft:hotfix-2026-05-07-x
#   ./scripts/docker-build.sh ghcr.io/.../statecraft:hotfix --arch amd64

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

IMAGE_TAG="${1:-ghcr.io/statecrafting/open-agentic-platform/statecraft:hotfix-local}"
ARCH="amd64"
if [[ "${2:-}" == "--arch" ]]; then
  ARCH="${3:-amd64}"
fi

MAIN_MJS=".encore/build/combined/combined/main.mjs"

echo "==> Fast statecraft docker build (minimal-swap)"
echo "    Image: $IMAGE_TAG"
echo "    Arch:  linux/$ARCH"

# Step 1 — produce the bundled main.mjs (cancel-then-scrape).
# Encore writes main.mjs early in its docker pipeline, then sits in a
# slow gzip/layer-assembly phase. We poll until main.mjs is on disk and
# its size has been stable for 10s, then kill the encore CLI.
mkdir -p "$(dirname "$MAIN_MJS")"
rm -f "$MAIN_MJS" "$MAIN_MJS.map"

echo "==> Compiling encore application (will cancel once main.mjs stabilises)..."
encore build docker --arch "$ARCH" --config ./infra.config.json \
    encore-scratch:cancel-then-scrape > /tmp/encore-scratch-build.log 2>&1 &
ENCORE_PID=$!

LAST_SIZE=0
STABLE_TICKS=0
ELAPSED=0
while kill -0 "$ENCORE_PID" 2>/dev/null; do
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  if [[ -f "$MAIN_MJS" ]]; then
    SIZE=$(stat -f%z "$MAIN_MJS" 2>/dev/null || stat -c%s "$MAIN_MJS")
    if [[ "$SIZE" == "$LAST_SIZE" ]] && [[ "$SIZE" != "0" ]]; then
      STABLE_TICKS=$((STABLE_TICKS + 1))
      if [[ $STABLE_TICKS -ge 2 ]]; then
        echo "    main.mjs stable at $SIZE bytes after ${ELAPSED}s — cancelling encore"
        kill "$ENCORE_PID" 2>/dev/null || true
        sleep 2
        break
      fi
    else
      STABLE_TICKS=0
    fi
    LAST_SIZE=$SIZE
  fi
  if [[ $ELAPSED -gt 300 ]]; then
    echo "ERROR: main.mjs never stabilised within 300s — encore may be stuck"
    kill "$ENCORE_PID" 2>/dev/null || true
    cat /tmp/encore-scratch-build.log
    exit 1
  fi
done
wait "$ENCORE_PID" 2>/dev/null || true

if [[ ! -f "$MAIN_MJS" ]]; then
  echo "ERROR: main.mjs was never produced"
  cat /tmp/encore-scratch-build.log
  exit 1
fi

# Step 2 — refresh the react-router client build. Asset filenames are
# content-hashed; main.mjs references the new hashes, so the static
# tree under web/build/client/ must be regenerated before docker build.
echo "==> Building react-router frontend..."
(cd web && npx react-router build)

# Step 3 — feed main.mjs + web/build/ into the minimal-swap Dockerfile.
echo "==> Building docker image..."
docker build \
  --platform "linux/$ARCH" \
  -t "$IMAGE_TAG" \
  -f Dockerfile \
  .

echo "==> Done! Image: $IMAGE_TAG"
SIZE_BYTES=$(docker image inspect "$IMAGE_TAG" --format '{{.Size}}')
echo "    Size: $(numfmt --to=iec "$SIZE_BYTES" 2>/dev/null || echo "$SIZE_BYTES bytes")"

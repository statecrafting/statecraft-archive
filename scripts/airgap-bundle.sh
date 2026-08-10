#!/usr/bin/env bash
# Produce the offline install bundle for one architecture (spec 029 §3.3).
#
#   scripts/airgap-bundle.sh <arch> [options]     arch: amd64 | arm64
#
# The bundle is everything an operator needs to install a cell on a host with
# no outbound network: the image as a `docker save` archive, its cosign
# signature and SPDX SBOM attestation, a checksum manifest over every member,
# a generated verify.sh, and the operator manual (spec 028) for the exact
# version inside the bundle, because an air-gapped operator cannot read
# documentation on a website.
#
# One architecture per bundle, deliberately. `docker load` on a stock Docker
# daemon (the classic image store) cannot consume a multi-platform archive, and
# an air-gapped host has exactly one architecture, so a multi-arch bundle would
# double an 800 MB transfer to deliver something half of which cannot run there.
#
# Options:
#   --image REF        image repository (default ghcr.io/statecrafting/enrahitu)
#   --version V        tag to bundle (default: latest)
#   --out DIR          output directory (default: dist/airgap)
#   --from-archive P   use an existing `docker save` archive instead of pulling.
#                      The bundle's shape, its checksum manifest and verify.sh
#                      do not depend on what is inside the archive, so this is
#                      also how the test suite exercises the verifier without a
#                      795 MB pull.
#   --sign             sign checksums.txt with cosign keyless before packing, so
#                      the tarball carries the signature (CI uses this on
#                      release). Requires cosign and an ambient OIDC identity.
#   --skip-signatures  do not attempt to download the image's cosign material.
set -euo pipefail

ARCH="${1:-}"
case "$ARCH" in
  amd64 | arm64) shift ;;
  "") echo "usage: scripts/airgap-bundle.sh <amd64|arm64> [options]" >&2; exit 2 ;;
  *) echo "unsupported arch: $ARCH (amd64|arm64)" >&2; exit 2 ;;
esac

IMAGE="ghcr.io/statecrafting/enrahitu"
VERSION="latest"
OUT=""
FROM_ARCHIVE=""
SIGN=0
SKIP_SIGNATURES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="${2:?--image needs a value}"; shift 2 ;;
    --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
    --out) OUT="${2:?--out needs a value}"; shift 2 ;;
    --from-archive) FROM_ARCHIVE="${2:?--from-archive needs a value}"; shift 2 ;;
    --sign) SIGN=1; shift ;;
    --skip-signatures) SKIP_SIGNATURES=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -n "$OUT" ] || OUT="$ROOT/dist/airgap"

REF="$IMAGE:$VERSION"
NAME="enrahitu-$VERSION-linux-$ARCH"
BUNDLE="$OUT/$NAME"

# sha256sum is coreutils; macOS ships shasum. verify.sh resolves the same pair
# on the operator's host, so a manifest written on either is checkable on either.
if command -v sha256sum >/dev/null 2>&1; then
  sha_write() { sha256sum "$@"; }
elif command -v shasum >/dev/null 2>&1; then
  sha_write() { shasum -a 256 "$@"; }
else
  echo "neither sha256sum nor shasum found; cannot write a checksum manifest" >&2
  exit 1
fi

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE"

# ---------------------------------------------------------------------------
# 1. The image archive
# ---------------------------------------------------------------------------
ARCHIVE="$BUNDLE/$NAME.tar"
DIGEST=""
if [ -n "$FROM_ARCHIVE" ]; then
  [ -f "$FROM_ARCHIVE" ] || { echo "no such archive: $FROM_ARCHIVE" >&2; exit 1; }
  echo "==> image archive (supplied): $FROM_ARCHIVE"
  cp "$FROM_ARCHIVE" "$ARCHIVE"
else
  echo "==> pulling $REF (linux/$ARCH)"
  docker pull --platform "linux/$ARCH" "$REF" >/dev/null
  # The digest, not the tag: a tag is a mutable pointer and this bundle exists
  # to carry custody. This is what the signature and the SBOM are attached to.
  DIGEST="$(docker image inspect "$REF" --format '{{index .RepoDigests 0}}' 2>/dev/null | sed 's/.*@//')"
  echo "==> docker save -> $(basename "$ARCHIVE")"
  docker save "$REF" -o "$ARCHIVE"
fi

# ---------------------------------------------------------------------------
# 2. The image's signature and SBOM attestation
# ---------------------------------------------------------------------------
SIG_STATE="absent"
SBOM_STATE="absent"
if [ "$SKIP_SIGNATURES" = "1" ]; then
  echo "==> skipping cosign material (--skip-signatures)"
elif ! command -v cosign >/dev/null 2>&1; then
  echo "==> cosign not found; bundling without the image's signature material" >&2
else
  SIGNED_REF="$REF"
  [ -n "$DIGEST" ] && SIGNED_REF="$IMAGE@$DIGEST"
  echo "==> cosign download signature $SIGNED_REF"
  if cosign download signature "$SIGNED_REF" > "$BUNDLE/image.sig.json" 2>/dev/null \
     && [ -s "$BUNDLE/image.sig.json" ]; then
    SIG_STATE="present"
  else
    echo "    no signature found for $SIGNED_REF" >&2
    rm -f "$BUNDLE/image.sig.json"
  fi
  echo "==> cosign download attestation $SIGNED_REF"
  if cosign download attestation --predicate-type spdxjson "$SIGNED_REF" \
       > "$BUNDLE/sbom.spdx.attestation.json" 2>/dev/null \
     && [ -s "$BUNDLE/sbom.spdx.attestation.json" ]; then
    SBOM_STATE="present"
  else
    echo "    no SPDX attestation found for $SIGNED_REF" >&2
    rm -f "$BUNDLE/sbom.spdx.attestation.json"
  fi
fi

# ---------------------------------------------------------------------------
# 3. The operator manual for exactly this version
# ---------------------------------------------------------------------------
mkdir -p "$BUNDLE/docs"
for doc in OPERATIONS.md ARCHITECTURE.md; do
  [ -f "docs/$doc" ] && cp "docs/$doc" "$BUNDLE/docs/$doc"
done

# ---------------------------------------------------------------------------
# 4. Bundle metadata: what is inside, and what it was built from
# ---------------------------------------------------------------------------
RAUTHY_DIGEST="$(sed -n 's|^FROM ghcr\.io/sebadob/rauthy@\([a-z0-9:]*\).*|\1|p' docker/Dockerfile | head -1)"
SOURCE_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
cat > "$BUNDLE/bundle.json" <<JSON
{
  "image": "$IMAGE",
  "version": "$VERSION",
  "arch": "$ARCH",
  "platform": "linux/$ARCH",
  "imageDigest": "${DIGEST:-unknown}",
  "rauthyDigest": "${RAUTHY_DIGEST:-unknown}",
  "sourceCommit": "$SOURCE_COMMIT",
  "archive": "$NAME.tar",
  "spec": "029-supply-chain-provenance"
}
JSON

# ---------------------------------------------------------------------------
# 5. verify.sh
# ---------------------------------------------------------------------------
cat > "$BUNDLE/verify.sh" <<'VERIFY'
#!/usr/bin/env bash
# Verify this bundle before installing it (spec 029 §3.3).
#
#   ./verify.sh [--allow-unsigned]
#
# Two independent checks, reported separately, because they fail for different
# reasons and an operator needs to know which one gave way:
#
#   1. Integrity: every member matches checksums.txt. Needs only coreutils, so
#      it always runs.
#   2. Authenticity: the checksum manifest carries a valid cosign signature from
#      this repository's release workflow. Needs cosign and the bundled
#      signature material. When it cannot run, this script says so and exits
#      non-zero rather than reporting a success it did not establish.
#
# --allow-unsigned downgrades a missing verifier (not a failed check) to a
# warning, for an operator who genuinely cannot install cosign. A signature that
# is present and does not verify is always fatal.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ALLOW_UNSIGNED=0
[ "${1:-}" = "--allow-unsigned" ] && ALLOW_UNSIGNED=1

if command -v sha256sum >/dev/null 2>&1; then
  sha_check() { sha256sum -c "$@"; }
elif command -v shasum >/dev/null 2>&1; then
  sha_check() { shasum -a 256 -c "$@"; }
else
  echo "FAIL: neither sha256sum nor shasum is available; integrity NOT checked" >&2
  exit 1
fi

echo "== integrity =="
if [ ! -f checksums.txt ]; then
  echo "FAIL: checksums.txt is missing; this bundle cannot be verified at all." >&2
  exit 1
fi

# Missing members are found by looking, not by reading the checksum tool's
# output. Darwin's sha256sum reports an absent file only on stderr and prints no
# FAILED line at all, so a deleted member reads as a clean run on stdout. An
# attacker removing the SBOM or verify.sh is exactly the case this must catch.
MISSING=""
while IFS= read -r line; do
  [ -n "$line" ] || continue
  member="$(printf '%s' "$line" | sed 's/^[0-9a-fA-F][0-9a-fA-F]*[[:space:]][[:space:]]*\*\{0,1\}//')"
  [ -f "$member" ] || MISSING="${MISSING}${member}"$'\n'
done < checksums.txt

ALTERED="$(sha_check checksums.txt 2>/dev/null | grep -v ': OK$' || true)"

if [ -n "$MISSING" ] || [ -n "$ALTERED" ]; then
  echo "FAIL: bundle integrity check failed."
  if [ -n "$MISSING" ]; then
    echo "  missing entirely:"
    printf '%s' "$MISSING" | sed 's/^/    /'
  fi
  if [ -n "$ALTERED" ]; then
    echo "  does not match its checksum:"
    printf '%s\n' "$ALTERED" | sed 's/^/    /'
  fi
  echo
  echo "Do not install this bundle. A member that is missing or does not match its"
  echo "checksum has been altered, truncated or removed since the bundle was made."
  exit 1
fi
echo "OK: every member is present and matches checksums.txt"

echo
echo "== authenticity =="
# A regexp, because the release tag is part of the signing identity and differs
# per release. Anchored and with the literal dots escaped, so it cannot match a
# workflow in some other repository whose name happens to contain this one.
IDENTITY="${COSIGN_IDENTITY:-^https://github\.com/statecrafting/enrahitu/\.github/workflows/image\.yml@refs/tags/.+$}"
ISSUER="${COSIGN_ISSUER:-https://token.actions.githubusercontent.com}"

if [ ! -f checksums.txt.bundle ]; then
  echo "NOT CHECKED: this bundle carries no signature material."
  echo "  (checksums.txt.bundle is absent)"
  echo "  Integrity was verified; authenticity was NOT. You have established that"
  echo "  the bundle is internally consistent, not that it came from this project."
  if [ "$ALLOW_UNSIGNED" = "1" ]; then
    echo "  Proceeding anyway: --allow-unsigned was passed."
    exit 0
  fi
  exit 2
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "NOT CHECKED: cosign is not installed, so the signature was not verified."
  echo "  Integrity was verified; authenticity was NOT."
  echo "  Install cosign (https://docs.sigstore.dev/cosign/installation/) and"
  echo "  re-run, or re-run with --allow-unsigned to accept integrity alone."
  if [ "$ALLOW_UNSIGNED" = "1" ]; then
    echo "  Proceeding anyway: --allow-unsigned was passed."
    exit 0
  fi
  exit 2
fi

# --offline keeps this from reaching for the transparency log, which an
# air-gapped host cannot reach by definition; the bundle carries the log entry
# that makes the short-lived Fulcio certificate checkable at signing time.
# Only cosign's own exit 0 counts as verified, and its diagnosis is shown as-is
# on failure rather than being reinterpreted here.
COSIGN_OUT="$(cosign verify-blob \
  --bundle checksums.txt.bundle \
  --certificate-identity-regexp "$IDENTITY" \
  --certificate-oidc-issuer "$ISSUER" \
  --offline \
  checksums.txt 2>&1)"
COSIGN_RC=$?

if [ "$COSIGN_RC" = "0" ]; then
  echo "OK: checksums.txt carries a valid signature from $IDENTITY"
  echo
  echo "Both checks passed. Load the image with:"
  echo "  docker load -i $(ls ./*.tar 2>/dev/null | head -1 | sed 's|^\./||')"
  exit 0
fi

echo "FAIL: the signature on checksums.txt did not verify."
echo "  Expected identity (regexp): $IDENTITY"
echo "  Expected issuer:            $ISSUER"
echo "  cosign said:"
echo "$COSIGN_OUT" | sed 's/^/    /'
echo
echo "  Do not install this bundle."
exit 1
VERIFY
chmod 0755 "$BUNDLE/verify.sh"

# ---------------------------------------------------------------------------
# 6. The checksum manifest, over every member written above
# ---------------------------------------------------------------------------
echo "==> checksum manifest"
MEMBERS="$(mktemp)"
trap 'rm -f "$MEMBERS"' EXIT
( cd "$BUNDLE" && find . -type f ! -name checksums.txt -print | LC_ALL=C sort ) > "$MEMBERS"
(
  cd "$BUNDLE"
  : > checksums.txt
  while IFS= read -r member; do
    sha_write "$member" >> checksums.txt
  done < "$MEMBERS"
)

# ---------------------------------------------------------------------------
# 7. Sign the manifest, so the bundle inherits the image's chain of custody
# ---------------------------------------------------------------------------
MANIFEST_SIG_STATE="unsigned"
if [ "$SIGN" = "1" ]; then
  if ! command -v cosign >/dev/null 2>&1; then
    echo "--sign was passed but cosign is not installed" >&2
    exit 1
  fi
  echo "==> cosign sign-blob checksums.txt"
  ( cd "$BUNDLE" && COSIGN_EXPERIMENTAL=1 cosign sign-blob --yes \
      --bundle checksums.txt.bundle \
      --output-certificate checksums.txt.pem \
      --output-signature checksums.txt.sig \
      checksums.txt >/dev/null )
  MANIFEST_SIG_STATE="signed"
fi

# ---------------------------------------------------------------------------
# 8. The tarball
# ---------------------------------------------------------------------------
echo "==> $NAME.tar.gz"
( cd "$OUT" && tar -czf "$NAME.tar.gz" "$NAME" )

echo
echo "bundle:           $BUNDLE"
echo "tarball:          $OUT/$NAME.tar.gz"
echo "image signature:  $SIG_STATE"
echo "image SBOM:       $SBOM_STATE"
echo "checksum manifest: $MANIFEST_SIG_STATE"
if [ "$MANIFEST_SIG_STATE" = "unsigned" ]; then
  echo
  echo "This bundle's checksum manifest is unsigned, so verify.sh will report"
  echo "authenticity as NOT CHECKED. CI passes --sign on release (spec 029 §3.3)."
fi

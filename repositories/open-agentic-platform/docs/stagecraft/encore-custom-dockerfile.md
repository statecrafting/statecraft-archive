# Custom Dockerfile for Encore.ts — the "cancel-then-scrape" technique

A portable recipe for building a fully custom OCI image for an Encore.ts
application **without** going through `encore build docker`.

Useful when:

- `encore build docker`'s gzip layer step is pathologically slow on your machine
  (15+ min for a ~200 MB image is typical — `go-containerregistry` single-threaded
  compression over the node runtime blob)
- You need to pin the base image, OS packages, or system binaries beyond what
  Encore's `--base` flag lets you compose
- You want a single `docker build` you can iterate on locally without going
  through the Encore CLI each time
- Your CI runs in a specialised environment (airgapped, custom cache, rootless,
  Kaniko, BuildKit remote, etc.) where the Encore-in-docker path is awkward

The official Encore CLI **does not** currently expose a `build bin` or equivalent
subcommand to emit a self-contained JS artifact directory. Verified against
`encore version v1.56.6`:

```
$ encore build --help
Available Commands:
  docker      docker builds a portable docker image of your Encore application
```

If a future Encore release adds `build bin`, use that instead — this document
describes the workaround for versions that don't.

---

## The technique, at a glance

1. **Start** `encore build docker` and let it run just long enough to finish the
   JavaScript compile step (usually ~30 s), then **cancel it** before the slow
   gzip-layer step begins.
2. **Scrape** the compiled bundle from Encore's internal build cache:
   `./.encore/build/combined/combined/main.mjs`
3. **Copy** the native Encore runtime out of the user-cache directory:
   `~/Library/Caches/encore/cache/bin/<version>/<goos>/<goarch>/encore-runtime.node`
4. **Build** your own Dockerfile that `COPY`s those two files plus your
   `node_modules`, static assets, and any other runtime dependencies.

Both of the scraped paths are **Encore internals** and may move between CLI
releases. Pin your Encore version and verify the layout after every bump.

---

## Step 1 — Produce `main.mjs` without finishing the docker build

From your Encore service root (where `encore.app` lives):

```bash
# Any infra.config will do — Encore still runs the JS compile.
encore build docker --config infra.config.dev.json scratch-tag:latest &
ENCORE_PID=$!

# Poll until the compiled entrypoint exists, then kill the CLI.
while [[ ! -f .encore/build/combined/combined/main.mjs ]]; do
  sleep 1
  kill -0 "$ENCORE_PID" 2>/dev/null || { echo "encore exited"; exit 1; }
done
kill "$ENCORE_PID" 2>/dev/null || true
wait "$ENCORE_PID" 2>/dev/null || true
```

After this, you have:

```
.encore/build/combined/combined/main.mjs       # your compiled app
.encore/build/combined/combined/main.mjs.map   # source map (optional)
```

### What's inside `main.mjs`?

A single esbuild-bundled JavaScript file that wires every Encore service in your
app into one entrypoint. It calls into `encore-runtime.node` (a native addon)
for HTTP, PubSub, SQL, secrets, and tracing — so you need the runtime binary in
the same image.

---

## Step 2 — Locate the Encore native runtime

The Encore CLI caches per-(version, os, arch) runtime binaries under the user
cache directory. On macOS:

```
~/Library/Caches/encore/cache/bin/<version>/<goos>/<goarch>/encore-runtime.node
```

On Linux this is typically `~/.cache/encore/bin/...`.

For a `linux/amd64` container built from a macOS host:

```bash
ENCORE_VERSION="$(encore version 2>&1 | awk '/^encore version/ {print $3}')"
RUNTIME_SRC="$HOME/Library/Caches/encore/cache/bin/${ENCORE_VERSION}/linux/amd64/encore-runtime.node"

test -f "$RUNTIME_SRC" || {
  echo "runtime missing for ${ENCORE_VERSION} linux/amd64"
  echo "hint: run 'encore build docker --os linux --arch amd64 ...' once to populate the cache"
  exit 1
}

cp "$RUNTIME_SRC" ./encore-runtime.node
```

If the target runtime is missing, run `encore build docker --os linux --arch amd64 scratch:_` once — even if you cancel it, the runtime will be downloaded
into the cache.

---

## Step 3 — Your Dockerfile

Minimal working example for a TypeScript Encore app:

```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app

# System deps your runtime code calls out to (optional)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Production node_modules only
COPY --from=deps /app/node_modules ./node_modules

# Compiled Encore application (scraped from step 1)
COPY .encore/build/combined/combined/main.mjs ./main.mjs

# Encore native runtime for the target linux arch (scraped from step 2)
COPY encore-runtime.node /app/encore-runtime.node

# Anything else your app serves or runs at startup:
#   - static assets (e.g. a React build)
#   - migration scripts
#   - seed scripts
#   - helper binaries
# COPY web/build/ ./build/
# COPY scripts/migrate.mjs ./scripts/migrate.mjs

ENV ENCORE_RUNTIME_LIB=/app/encore-runtime.node
ENV NODE_ENV=production

EXPOSE 4000
CMD ["node", "main.mjs"]
```

Key environment variable: `ENCORE_RUNTIME_LIB` must point at the native runtime.
Without it the runtime fails to bind and the process exits silently.

Build:

```bash
docker build -t myapp:local .
docker run --rm -p 4000:4000 --env-file .env myapp:local
```

---

## Step 4 — Wire into your service's startup (if needed)

Encore normally handles secret injection, infra config, and HTTP binding from
the image metadata that `encore build docker` writes. When you build your own
image, you provide those via environment variables yourself — typically the
same ones `infra.config.<env>.json` would set. Pass them at `docker run` time
or via your orchestrator (K8s Deployment, docker-compose, etc.).

At minimum you usually need:

- `PORT` (defaults to 4000 but set it explicitly for clarity)
- Secret values referenced by `secret("Name")` calls — as plain env vars of the
  same name, or mounted via your secret provider
- Database connection strings, if your infra config binds named databases to
  env variables

---

## Trade-offs

| | `encore build docker` | `encore build docker --base <img>` | Manual (this doc) |
|---|---|---|---|
| Supported by Encore | Yes | Yes | No — reaches into internals |
| Build time on typical machines | 10–15+ min (slow gzip) | Same as plain | 30–60 s |
| Customise OS packages | No | Yes | Yes |
| Bring your own node | No | Partial | Yes |
| Breaks on Encore version bumps | Rare | Rare | Possible — verify layout |
| Reproducibility in CI | Excellent | Excellent | Excellent if paths are pinned |

Use the manual approach when the benefits (speed, full control) outweigh the
brittleness. For teams that ship frequently and care about Encore upgrade
hygiene, **`encore build docker --base <img>`** is the better long-term
answer — the `--base` flag is the supported way to layer in system deps and
custom binaries without hand-rolling the runtime glue.

---

## Pitfalls

- **Cancelled build leaves the image tag dangling.** The `scratch-tag:latest`
  above will exist as a partial/invalid image in your local docker daemon.
  `docker image rm scratch-tag:latest` before re-running, or use a unique tag
  per run.
- **Wrong-arch runtime.** Building a linux/amd64 image on an Apple Silicon host
  and accidentally copying the `darwin/arm64` runtime will fail with an opaque
  `invalid ELF header` at startup. Always verify `file encore-runtime.node`
  reports the expected target.
- **Encore version drift.** The internal path
  `.encore/build/combined/combined/main.mjs` may change. If a future CLI writes
  to a different subdirectory, add a fallback that greps for the newest
  `main.mjs` under `.encore/build/`.
- **Missing services.** `encore build docker` compiles every service in the app
  by default. If you pass `--services` or `--gateways` to subset the build, the
  compiled `main.mjs` will reflect that subset — re-run without the flag if you
  want everything.
- **No infra config embedded.** The supported builder bakes your chosen
  `infra.config.*.json` into the image. When building manually, you must pass
  the equivalent configuration as environment variables at container run time.

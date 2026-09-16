# Custom Dockerfile

When deploying via the Encore Container Path, Encore uses a base Dockerfile to build the final image.

The repository provides this base Dockerfile at `apps/api/Dockerfile.base`.

## `Dockerfile.base`

This Dockerfile is responsible for:
1. Using an Alpine Linux base image.
2. Installing necessary system dependencies (e.g., `ca-certificates`, `tzdata`).
3. Copying the pre-built Vue SPA assets from `apps/api/web/build` into the container image.

```dockerfile
# apps/api/Dockerfile.base
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

# Copy the built Vue SPA assets into the image
# (Assumes the build context is apps/api and the SPA has been built)
COPY web/build /app/web/build
```

During the `encore build docker` step, Encore takes this base image, injects the compiled Node.js backend code and the native `encore-runtime`, and sets the entrypoint.

## Modifying the Base Image

If your application requires additional system-level dependencies (e.g., native libraries for image processing), you should add the corresponding `apk add` commands to `Dockerfile.base`.

Do not attempt to override the entrypoint or CMD, as Encore manages the execution lifecycle of the backend process.

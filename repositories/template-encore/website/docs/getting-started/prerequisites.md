# Prerequisites

Before you can build and run **acme-vue-encore**, you must ensure your local development environment meets the following requirements.

## System Requirements

- **Node.js**: Version 24.0.0 or higher. The repository includes an `.nvmrc` file specifying `24`.
- **npm**: Version 10.0.0 or higher.
- **Docker**: Required to run the local Postgres database automatically provisioned by Encore.
- **Encore CLI**: The Encore toolchain must be installed to run the backend.

### Installing Encore CLI

Follow the official [Encore installation guide](https://encore.dev/docs/install). On macOS or Linux, you can typically install it via:

```bash
curl -L https://encore.dev/install.sh | bash
```

## Recommended Editor Setup

For the best development experience, we strongly recommend using **Visual Studio Code** with the following extensions:

1. **Vue - Official (Volar)**: For Vue 3 `<script setup>` support and TypeScript integration.
2. **ESLint**: For inline linting.
3. **Prettier - Code formatter**: For consistent code formatting.
4. **Encore**: For Encore.ts syntax highlighting and environment integration.

Ensure that your editor is configured to use the workspace version of TypeScript rather than the globally installed version.

# Quick Start

Follow these steps to get **acme-vue-encore** running locally on your machine.

## 1. Clone the Repository

Clone the repository and navigate into the project directory:

```bash
git clone https://github.com/statecrafting/template-encore.git
cd template-encore
```

## 2. Install Dependencies

The project requires a two-step installation process because the Encore API is a standalone application excluded from the root npm workspaces.

First, install the root workspace dependencies (which covers the SPAs and shared packages):

```bash
npm install
```

Second, install the standalone Encore app dependencies and generate the development JWT keys:

```bash
cd apps/api
npm install
npm run generate-keys
cp .env.example .env
cd ../..
```

> The `npm run generate-keys` command writes RSA-2048 JWT signing keys into `apps/api/keys/*.pem`. These files are gitignored and automatically loaded in development. The `.env.example` file configures the application to use the `mock` authentication driver by default.

## 3. Run the Application

Start the development servers concurrently from the repository root:

```bash
npm run dev
```

This command builds the shared packages, starts the Encore API on port 4000 (`encore run --port=4000`), and launches both Vue Vite development servers. The Vite servers automatically proxy `/api/*` requests to the Encore API.

> **Note**: Docker must be running so Encore can automatically provision and start the local Postgres database.

## Local URLs

Once the servers are running, you can access the applications at the following local URLs:

- **Public Web App**: `http://localhost:5173`
- **Internal Web App**: `http://localhost:5174`
- **Encore API**: `http://localhost:4000`
- **Health Check**: `http://localhost:4000/health`

To log in, visit `http://localhost:5173`, click **Sign In**, and select one of the mock users (e.g., Developer, Administrator, or Standard User).

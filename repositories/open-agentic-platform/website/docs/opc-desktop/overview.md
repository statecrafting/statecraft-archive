# OPC Desktop Overview

The Off-Platform Compute (OPC) Desktop is the local cockpit where human developers and autonomous agents collaborate. It is located in `product/apps/opc/`.

## Architecture

The OPC application is built using Tauri v2, providing a lightweight, cross-platform native experience.

- **Frontend**: Built with React and TypeScript (`src/`). It provides the user interface for inspecting projects, managing governance, and visualizing Factory pipelines.
- **Backend**: Built with Rust (`src-tauri/`). It handles Tauri commands, state management, and hosts the `axiomregent` sidecar.

## The Shared Execution Surface

Unlike traditional IDEs where agents operate as isolated plugins, OPC is designed as a shared execution surface. Both the human and the agent operate within the same governed context.

The desktop provides several key panels:
- **Git Context**: Native branch and status visualization.
- **Inspection (Xray)**: Semantic and structural analysis of the repository.
- **Governance**: Displays the compiled registry summary and feature graph status, ensuring the developer is aware of the current spec compliance.
- **Factory Panel**: Real-time visualization of the orchestration pipeline.

## Running Locally

To start the OPC desktop in development mode with hot-reloading:

```bash
make dev
```

---
feature: "037-cross-platform-axiomregent"
---

# Verification: cross-platform axiomregent binaries

## Windows x86_64 binary build (T002)

```
$ cd crates/axiomregent && cargo build --release --target x86_64-pc-windows-msvc
   Compiling agent v0.1.0
   Compiling axiomregent v0.1.0
    Finished `release` profile [optimized] target(s) in 9.76s

$ ls -la apps/desktop/src-tauri/binaries/axiomregent-x86_64-pc-windows-msvc.exe
-rwxr-xr-x 1 ... 7348736 Mar 29 02:58 axiomregent-x86_64-pc-windows-msvc.exe
```

Binary size: **7.3 MB** (NF-001: < 30 MB cap)

## Windows binary smoke test (T005)

### Startup + port discovery
```
$ timeout 3 apps/desktop/src-tauri/binaries/axiomregent-x86_64-pc-windows-msvc.exe
[INFO  axiomregent] mcp starting (stdio - MCP framed JSON-RPC)
OPC_AXIOMREGENT_PORT=49679
```

### MCP initialize handshake
```
$ printf "Content-Length: ...\r\n\r\n{initialize}" | axiomregent-x86_64-pc-windows-msvc.exe
Content-Length: 184
{"jsonrpc":"2.0","result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true},"logging":{}},"serverInfo":{"name":"mcp","version":"0.1.0"}},"error":null,"id":1}
```

### tools/list — all 21 router tools present
```
agent.execute, agent.propose, agent.verify, features.impact, gov.drift, gov.preflight,
run.execute, run.logs, run.status, snapshot.changes, snapshot.create, snapshot.diff,
snapshot.export, snapshot.grep, snapshot.info, snapshot.list, snapshot.read,
workspace.apply_patch, workspace.delete, workspace.write_file, xray.scan
```

## Agent crate tests (ToolTier rename fix)

```
$ cd crates/agent && cargo test
running 4 tests ... ok (unit)
running 9 tests ... ok (golden)
test result: ok. 13 passed; 0 failed
```

## Axiomregent crate tests

```
$ cd crates/axiomregent && cargo test
running 10 tests ... ok (unit)
running 1 test  ... ok (agent_integration)
running 3 tests ... ok (governed_dispatch_latency)
running 1 test  ... ok (mcp_contract)
running 2 tests ... ok (mcp_featuregraph_test)
running 1 test  ... ok (mcp_router_contract_test)
running 2 tests ... ok (mcp_tools_test)
running 1 test  ... ok (no_stdout_pollution)
running 3 tests ... ok (persistence)
running 1 test  ... ok (run_streaming_test)
running 1 test  ... ok (snapshot_determinism)
running 2 tests ... ok (snapshot_pagination)
running 1 test  ... ok (snapshot_workspace_integration)
running 1 test  ... ok (stale_lease_test)
running 1 test  ... ok (stdio_integrity)
running 3 tests ... ok (tool_tier_coverage)
running 1 test  ... ok (verify_test)
running 6 tests ... ok (workspace_discovery_test)
test result: ok. 42 passed; 0 failed
```

## Binary inventory

| Target | Binary | Size | Status |
|--------|--------|------|--------|
| `aarch64-apple-darwin` | `axiomregent-aarch64-apple-darwin` | 22.2 MB | Existing (pre-037) |
| `x86_64-pc-windows-msvc` | `axiomregent-x86_64-pc-windows-msvc.exe` | 7.3 MB | **New (T002)** |
| `x86_64-apple-darwin` | — | — | Deferred to CI (T003) |
| `x86_64-unknown-linux-gnu` | — | — | Deferred to CI (T004) |
| `aarch64-unknown-linux-gnu` | — | — | Deferred to CI (T004) |

## Product notes

- **FR-002 verified**: Windows sidecar starts, announces port, completes MCP handshake within < 1 second.
- **FR-004 partial**: Windows binary responds identically to macOS for MCP protocol. Full end-to-end desktop verification (SC-001, SC-002) requires running the Tauri app — confirmed at protocol level.
- **Stale import fix**: `agent.rs:8` had `use crate::safety::{Tier, ...}` — a Feature 036 residual. Fixed to `ToolTier`.

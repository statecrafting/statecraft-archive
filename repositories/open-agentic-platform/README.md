# open-agentic-platform

> **Archived.** Superseded by [statecraft](https://github.com/statecrafting/statecraft),
> the governed agentic delivery control plane.

The Open Agentic Platform was the first full expression of governed agentic
delivery: frozen, hash-verifiable specs as the unit of governance, a web
control plane, and a desktop execution cockpit (OPC). In July 2026 the system
was rebuilt ground-up as **Statecraft**, and the pieces live on under new names:

- The control plane continues as [statecraft](https://github.com/statecrafting/statecraft):
  tenants, factory, fleet, and the governance UI, itself the first production
  [enrahitu](https://github.com/statecrafting/enrahitu) app.
- The desktop cockpit is retired; its governance verbs continue in
  [statecraft-cli](https://github.com/statecrafting/statecraft-cli), one binary
  serving humans as a CLI and agents as an MCP server.
- The spec-governance engine continues as
  [spec-spine](https://github.com/statecrafting/spec-spine).
- The reusable primitives were extracted as
  [action-gate](https://github.com/statecrafting/action-gate),
  [attest-ledger](https://github.com/statecrafting/attest-ledger),
  [trust-window](https://github.com/statecrafting/trust-window), and
  [canonical-keysort-json](https://github.com/statecrafting/canonical-keysort-json).

The family front door is [statecraft.ing](https://statecraft.ing). This
repository stays public as the historical record the early essays on
[bartekus.com](https://bartekus.com/writing) refer to; the original README and
the full codebase remain in its git history.

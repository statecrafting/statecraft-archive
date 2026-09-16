# factory-encore

> **Archived.** Superseded by [enrahitu](https://github.com/statecrafting/enrahitu)
> and the [statecraft](https://github.com/statecrafting/statecraft) factory service.

factory-encore was a technology-agnostic software factory: business documents
in, a frozen Build Specification out, an adapter turning that specification
into a running application. The idea did not die; it moved. The template
became [enrahitu](https://github.com/statecrafting/enrahitu) (EnRaHiTu:
Encore.ts + rauthy + hiqlite + Turso), a self-contained single-container
application core with a versioned `template.toml` contract. The factory became
a service inside the [statecraft](https://github.com/statecrafting/statecraft)
control plane that consumes that contract and nothing else.

The family front door is [statecraft.ing](https://statecraft.ing). The
original README and the full codebase remain in this repository's git history.

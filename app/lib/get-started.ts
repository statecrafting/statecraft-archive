// Content for the get-started walkthrough (spec 004 section 3.5). Honest by
// construction: the "today" steps are things a reader can actually run now, and
// the "planned" steps link to the governing spec and say plainly that they are
// milestones, not shipped paths. The OAP-era eight-phase Hetzner/K3s bootstrap
// is not ported (spec 004 section 1); nothing here claims a self-host path that
// does not exist.

export interface StepLink {
  label: string;
  /** GitHub repo slug under the org, or a full URL, or a /registry path. */
  href: string;
}

export interface Step {
  id: string;
  title: string;
  body: string;
  /** A real, copy-pasteable command, when one exists. */
  command?: string;
  /** The governing spec in the baked registry, if any: builds a /registry link. */
  spec?: { repo: string; id: string };
  /** The repo this step is about: builds a GitHub link. */
  repo?: string;
  /** The chip on a step that is not runnable today; defaults to "planned". */
  badge?: string;
}

export const INSTALL_COMMAND = "cargo install spec-spine-cli";

// Runnable today. Each step is checkable: the command works, or the link goes
// to a public repo you can read and run.
export const TODAY_STEPS: Step[] = [
  {
    id: "govern",
    title: "Govern a repository you already have",
    body:
      "spec-spine is the one piece the whole family is built on, and it stands alone: it needs no account, no server and nothing else on this site. Install the released binary (v0.18.0, also on npm and PyPI), scaffold a corpus into an existing repository, and it compiles a typed registry, indexes your code, lints the corpus, and refuses code that drifts from its owning spec once spec-spine couple runs in your CI. This website is one of its governed corpora.",
    command: "spec-spine init && spec-spine compile && spec-spine lint",
    repo: "spec-spine",
  },
  {
    id: "substrate",
    title: "Run the enrahitu substrate",
    body:
      "enrahitu is the EnRaHiTu template chassis a stamped app is born from, and it is runnable on its own: Encore.ts, rauthy, hiqlite, and Turso in a single container with zero managed dependencies. Clone it and follow its README to bring the container up.",
    command: "git clone https://github.com/statecrafting/enrahitu",
    repo: "enrahitu",
    spec: { repo: "enrahitu", id: "007-single-container-packaging" },
  },
];

// Designed, not yet shipped. Each links to the governing spec so the claim is
// checkable, and says forward tense plainly.
export const PLANNED_STEPS: Step[] = [
  {
    id: "local-session",
    title: "Run a governed agent session on your own machine",
    body:
      "statecraft-cli implements a local, account-free governed run: candidate worktrees, a credential fence, an acceptance receipt and an action broker. It is not released. The only release, v0.1.0 of July 22, 2026, is the CLI and MCP server and predates the local engine, so installing it (install.sh included) does not give you the engine, and a packaged engine does not yet run outside a source checkout. No install command for it is published here until a release containing the engine exists and has been tested on a clean machine, which is the job statecraft-cli draft 130 specifies.",
    repo: "statecraft-cli",
    spec: { repo: "statecraft-cli", id: "130-member-distribution" },
    badge: "not released",
  },
  {
    id: "stamp",
    title: "Stamp an app from the template contract",
    body:
      "The stamp produces a complete application from the enrahitu chassis, born with a certificate that binds an explicit agentic posture. The chassis ships today; the template contract that drives the stamp is still being finalized, so a self-serve stamp is not a documented path yet. Follow the contract in the registry.",
    repo: "enrahitu",
    spec: { repo: "enrahitu", id: "009-template-contract" },
  },
  {
    id: "self-host",
    title: "Self-host the control plane",
    body:
      "Statecraft, the control plane, is AGPL-3.0. A deployment of it runs, but there is no reproducible self-host path: the deploy spec describes one specific cluster and is still in progress. Nor is there a hosted plane to sign up for. When a self-host path exists it will be documented here, with a command that has been run on a clean machine.",
    repo: "statecraft",
    spec: { repo: "statecraft", id: "009-control-plane-deploy" },
  },
];

// Where to go next after the walkthrough.
export const NEXT_LINKS: StepLink[] = [
  { label: "Read the whitepaper", href: "/papers" },
  { label: "Browse the registry", href: "/registry" },
  { label: "See the product family", href: "/products" },
];

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
}

export const INSTALL_COMMAND = "cargo install spec-spine-cli";

// Runnable today. Each step is checkable: the command works, or the link goes
// to a public repo you can read and run.
export const TODAY_STEPS: Step[] = [
  {
    id: "govern",
    title: "Govern a corpus with spec-spine",
    body:
      "spec-spine is the one piece the whole family is built on, and it runs today. Point it at a directory of markdown specs and it compiles a typed registry, indexes your code, lints the corpus, and refuses code that drifts from its owning spec. This website is one of its governed corpora.",
    command: INSTALL_COMMAND,
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
      "Statecraft, the control plane, is AGPL-3.0 and designed to be self-hostable. Standing up a self-hosted plane is itself an in-progress milestone; the home page status ladder rolls up exactly how far it has come, straight from the specs. The self-host path will be documented here when it ships.",
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

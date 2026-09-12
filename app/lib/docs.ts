// Docs seed (spec 002 §3). Three stubs sourced from the repos' own READMEs and
// specs: link and summarize, never fork prose. This module imports nothing so
// it is safe to pull into both the docs routes and the prerender config
// (react-router.config.ts). Repo metadata (license, url) is resolved from
// product-family.ts in the route, keyed by `repo`, so it is never duplicated
// here. Every claim is checkable against the linked spec or repo.

/** A link on a docs stub. An `href` beginning with "/" is an in-site route
 *  (rendered with the router Link); anything else opens in a new tab. */
export interface DocLink {
  label: string;
  href: string;
}

export interface DocSection {
  heading: string;
  /** Paragraphs, rendered in order. */
  body: string[];
}

export interface DocStub {
  slug: string;
  title: string;
  /** One-line summary shown on the docs index and under the title. */
  summary: string;
  /** Repo key into product-family.ts (for the license chip + repo link). */
  repo: string;
  /** Honest maturity marker: what you can run today vs. what is on the ladder. */
  maturity: "shipping" | "in-progress" | "planned";
  sections: DocSection[];
  links: DocLink[];
}

export const DOC_STUBS: DocStub[] = [
  {
    slug: "what-is-enrahitu",
    title: "What is EnRaHiTu",
    summary:
      "The single-container application chassis every stamped app is built from.",
    repo: "enrahitu",
    maturity: "shipping",
    sections: [
      {
        heading: "One container, zero managed dependencies",
        body: [
          "EnRaHiTu is an Encore.ts application core that carries its own datastore, its own identity provider, and its own web tier in a single container image. The name is the stack: Encore.ts, rauthy, hiqlite, and Turso.",
          "hiqlite runs in-process as a napi-rs native addon (a Raft-replicated SQLite), so there is no database process to operate alongside the app. CoreLedger is a decorator data layer over libSQL/Turso. Auth is rauthy behind a same-origin proxy with an OIDC driver, and the app serves its own SPA. The Encore toolchain is vendored (Rust core plus JS runtime via napi-rs), so there is no external CLI in the build.",
        ],
      },
      {
        heading: "Why it exists",
        body: [
          "The chassis is the substrate the rest of the family stands on. Every app the control plane stamps is an EnRaHiTu app, which is what makes operating a fleet of them uniform: one container and one volume each, the same shape every time.",
        ],
      },
    ],
    links: [
      { label: "enrahitu on GitHub", href: "https://github.com/statecrafting/enrahitu" },
      {
        label: "001: architecture spec",
        href: "/registry/enrahitu/001-enrahitu-architecture",
      },
      {
        label: "007: single-container packaging",
        href: "/registry/enrahitu/007-single-container-packaging",
      },
    ],
  },
  {
    slug: "the-template-contract",
    title: "The template contract",
    summary:
      "A versioned template.toml that binds what a stamped app is, and the agentic posture it is born with.",
    repo: "enrahitu",
    maturity: "in-progress",
    sections: [
      {
        heading: "template.toml",
        body: [
          "A stamp is a function of a contract version. The template contract (template.toml) is the versioned declaration of what a stamped app is: its shape, its verbs, and what may change under a governed upgrade. Pinning the version is what lets a chassis upgrade later run as a governed verb instead of a manual migration.",
        ],
      },
      {
        heading: "Born-with provenance",
        body: [
          "At stamp time the app receives a born-with certificate that binds an explicit agentic posture. An agent that later operates the app runs under a declared posture, recorded from the moment the app exists, rather than one inferred after the fact.",
          "This rung is part built: enrahitu 012, the born-with certificate, reports `implementation: complete`, while 009, the contract that drives the stamp, is still in progress. So the certificate exists and the stamp that would issue one at scale does not. The specs below carry the current state; the status ladder on the home page reads it live from the registry.",
        ],
      },
    ],
    links: [
      {
        label: "009: the template contract",
        href: "/registry/enrahitu/009-template-contract",
      },
      {
        label: "012: born-with provenance",
        href: "/registry/enrahitu/012-born-with-provenance",
      },
    ],
  },
  {
    slug: "self-hosting-the-control-plane",
    title: "Self-hosting the control plane (AGPL)",
    summary:
      "What AGPL-3.0 means for the plane, what you can run today, and what is on the ladder.",
    repo: "statecraft",
    maturity: "planned",
    sections: [
      {
        heading: "AGPL-3.0, and what it covers",
        body: [
          "The control plane (statecraft) is AGPL-3.0: you can run it and modify it, and network users are entitled to the source of your running version. The AGPL covers the plane, not what the plane stamps. Apps the factory stamps are the customer's own code, in the customer's own GitHub org, under whatever license the customer chooses.",
        ],
      },
      {
        heading: "What runs today, and what is planned",
        body: [
          "You can self-host the EnRaHiTu chassis now: it is a single container, and its specs are shipped. The control plane is a different matter, and the honest answer has two halves. It runs: a deployment of it serves app.statecraft.ing, and statecraft 009 describes that deployment. What does not exist is a self-host path for anyone else, because statecraft 009, the deploy spec, is still `implementation: in-progress` and describes one specific cluster rather than a reproducible install.",
          "So the specs are still the artifact for a reader. The thesis and the app-shell spec below describe the plane; the registry tracks how far each part has come. Two limits are worth knowing before you read further. No production stamp of an application is on a public record. And the plane's attestation chain is hash-linked with an anchor that statecraft 008 leaves unsigned until an operator key is configured, a key 009 records as declared with no delivery path, so re-checking the chain establishes internal consistency and not who produced it.",
        ],
      },
    ],
    links: [
      { label: "statecraft on GitHub", href: "https://github.com/statecrafting/statecraft" },
      {
        label: "001: the control-plane thesis",
        href: "/registry/statecraft/001-statecraft-thesis",
      },
      {
        label: "002: the EnRaHiTu app shell",
        href: "/registry/statecraft/002-app-shell",
      },
      {
        label: "008: governance attestation",
        href: "/registry/statecraft/008-governance-attestation",
      },
      {
        label: "009: the control-plane deploy",
        href: "/registry/statecraft/009-control-plane-deploy",
      },
    ],
  },
];

export function findDoc(slug: string): DocStub | undefined {
  return DOC_STUBS.find((d) => d.slug === slug);
}

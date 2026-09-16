import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

function HomepageHero() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <h1 className="hero__title">{siteConfig.title}</h1>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.installBlock}>
          <code>make setup</code>
        </div>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/installation">
            Get Started
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/concepts/the-governed-model"
            style={{marginLeft: '1rem'}}>
            The Governed Model
          </Link>
        </div>
      </div>
    </header>
  );
}

type FeatureItem = {
  title: string;
  description: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Spec Spine',
    description:
      'Frozen, hash-verifiable specs as the unit of governance. 222 markdown specs compile deterministically into per-spec JSON shards under .derived/spec-registry/by-spec/, read only through typed spec-spine registry subcommands.',
  },
  {
    title: 'Spec/code coupling gate',
    description:
      'Every code path a spec claims (via typed establishes / extends / co_authority edges, projected to implements:) must change together with its owning spec, or CI fails before merge (spec 127). The corpus is collapse-proof under agentic editing.',
  },
  {
    title: 'The OPC cockpit',
    description:
      'A local Tauri v2 plus React desktop where humans and agents share one governed surface: git context, semantic and structural analysis, snapshots, approval gates, and Factory pipeline visualization. It hosts the governed axiomregent MCP server with safety tiers and distributed worktree locks.',
  },
  {
    title: 'Governance certificate plus verifier',
    description:
      'Every factory run emits a self-authenticating governance-certificate.json binding requirements hash, frozen Build Spec hash, and per-stage artifact hashes; make verify-certificate exits non-zero on tamper with a specific artifact-hash diagnostic. The verifier does not trust the producer.',
  },
  {
    title: 'The platform control plane',
    description:
      'Rauthy OIDC identity (GitHub federated through Rauthy), deployd-api-rs scope-gated deployment orchestration over Helm, and the Encore.ts statecraft SaaS for auth, projects, knowledge extraction, audit, and the Factory lifecycle API.',
  },
  {
    title: 'The two-phase Factory engine',
    description:
      'Turns business documents into a frozen Build Spec through six sequential agent-driven stages (s0 through s5, with checkpoints), then fans out scaffolding (s6a through s6g) against a pluggable adapter, with verify-and-retry per step.',
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="padding-horiz--md padding-vert--lg">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function Home(): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="OAP: a governed operating system for AI-native software delivery, built from three layers (Spec Spine, Platform, OPC cockpit).">
      <HomepageHero />
      <main>
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              {FeatureList.map((props, idx) => (
                <Feature key={idx} {...props} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}

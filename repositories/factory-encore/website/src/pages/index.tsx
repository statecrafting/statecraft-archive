import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>

        <div className={styles.installBox}>
          <CodeBlock language="bash">
            make setup
          </CodeBlock>
        </div>

        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/quickstart">
            Get Started
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/concepts/three-layer-architecture">
            Architecture
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeatureCards() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          <div className="col col--6">
            <div className="text--center padding-horiz--md padding-vert--md">
              <Heading as="h3">Three-layer separation</Heading>
              <p>
                Universal process stages produce a Build Specification that never
                names a framework; a formal contract of five schemas defines the
                boundary; pluggable adapters implement one stack each. Adding a
                stack means adding an adapter.
              </p>
            </div>
          </div>
          <div className="col col--6">
            <div className="text--center padding-horiz--md padding-vert--md">
              <Heading as="h3">Lean baseline plus compose</Heading>
              <p>
                The deterministic <code>acme-vue-encore</code> generator clones
                the <code>template-encore</code> baseline and composes declarative
                modules in at create time (compile-time composition, no runtime
                loader), with <code>minimal</code>, <code>public</code>,
                and <code>internal</code> profiles and a dual-app mode.
              </p>
            </div>
          </div>
          <div className="col col--6">
            <div className="text--center padding-horiz--md padding-vert--md">
              <Heading as="h3">Spec-governed by construction</Heading>
              <p>
                A spec-spine kernel governs every code path: specs compile to a
                registry, a codebase index maps spec to code, and a PR-time
                coupling gate refuses code that drifts from its
                owning <code>spec.md</code> (waivers are
                visible <code>Spec-Drift-Waiver:</code> lines).
              </p>
            </div>
          </div>
          <div className="col col--6">
            <div className="text--center padding-horiz--md padding-vert--md">
              <Heading as="h3">Cross-repo lockstep</Heading>
              <p>
                A committed lockfile pins the <code>template-encore</code> ref,
                its core services, the module catalog, and the SHA-256 of the
                frozen app-invariant specs, so a fail-visible CI gate refuses any
                silent upstream drift.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Technology-agnostic software factory: a universal process and a formal contract, with pluggable per-stack adapters.">
      <HomepageHeader />
      <main>
        <FeatureCards />
      </main>
    </Layout>
  );
}

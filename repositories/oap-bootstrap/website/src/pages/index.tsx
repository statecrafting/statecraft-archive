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
          <code>go build -o oap-bootstrap ./cmd/oap-bootstrap</code>
        </div>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/quickstart">
            Get Started
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/concepts/phase-model"
            style={{marginLeft: '1rem'}}>
            How It Works
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
    title: 'One config file, fully resumable',
    description:
      'oap.env is the single source of truth and the state store: there is no state database. Every key is classified by provenance (user-supplied, generated, provider-produced, derived), and re-running any phase reconciles against oap.env plus live cloud / cluster state.',
  },
  {
    title: 'Wraps upstream setup.sh, never reimplements it',
    description:
      "The cluster and platform phases shell out to the forked repo's own platform/infra/hetzner/setup.sh (Phase 1 and Phase 2), bridging oap.env into a 0600 cleartext .env and shredding it after. The delta versus a hand-run is exactly the named automation gaps plus fork-and-parameterize.",
  },
  {
    title: 'No-click GitHub App plus Rauthy OIDC',
    description:
      "A single GitHub App is registered via the App Manifest flow, doubling as Rauthy's upstream login provider. The identity phase creates the four Rauthy OIDC clients (SPA, server, deployd M2M, knowledge-sweeper) via the admin API.",
  },
  {
    title: 'Secrets encrypted at rest with SOPS plus age',
    description:
      "oap.env is SOPS-encrypted using the operator's existing age key, with encrypted_regex scoping encryption to secret-classed keys only so non-secret config stays diffable. It falls back to plaintext with a loud warning when sops / age are absent.",
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--3')}>
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
      description="A single-binary Go CLI that forks OAP into a new GitHub org and brings its Hetzner K3s estate online, resumably.">
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

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
          <code>npm run dev</code>
        </div>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/quick-start">
            Get Started
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/concepts/architecture-overview"
            style={{marginLeft: '1rem'}}>
            Architecture
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
    title: 'Encore.ts backend, batteries included',
    description:
      'A single Encore.ts app (apps/api) decomposes into lib, db, health, auth, gateway, and web services with typed api() / api.raw() endpoints auto-discovered from encore.service.ts; no hand-maintained route registry.',
  },
  {
    title: 'Stateless multi-driver auth',
    description:
      'RS256 JWT (15-min access plus 7-day DB-backed, rotating / revocable refresh) in httpOnly cookies, CSRF double-submit, and pluggable SSO drivers (mock for dev, rauthy OIDC for production), all gated by an Encore authHandler plus Gateway.',
  },
  {
    title: 'BFF gateway proxy',
    description:
      'An api.raw catch-all proxies authenticated /api/v1/data/* requests to a private backend with service-to-service OAuth client-credentials tokens, path-traversal sanitization, 5xx-to-502 masking, timeout-to-504, and per-access audit (INV-10).',
  },
  {
    title: 'Born-with spec-spine governance',
    description:
      'A markdown spec corpus (specs/000-019) compiles to a deterministic registry; a PR-time coupling gate refuses changes to owned code whose owning spec is not edited in the same diff, enforced locally via make and in CI.',
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
      description="A lean, runnable Vue 3 plus Encore.ts reference app with stateless auth, a BFF gateway, and born-with spec-spine governance.">
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

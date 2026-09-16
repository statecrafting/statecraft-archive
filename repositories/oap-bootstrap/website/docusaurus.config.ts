import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'oap-bootstrap',
  tagline: 'Fork OAP into a new org and bring its Hetzner K3s estate online, resumably.',
  favicon: 'img/favicon.ico',

  url: 'https://statecrafting.github.io',
  baseUrl: '/oap-bootstrap/',

  organizationName: 'statecrafting',
  projectName: 'oap-bootstrap',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/statecrafting/oap-bootstrap/tree/main/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'oap-bootstrap',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/statecrafting/oap-bootstrap',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started/quickstart',
            },
            {
              label: 'How It Works',
              to: '/docs/concepts/phase-model',
            },
            {
              label: 'CLI Reference',
              to: '/docs/cli/commands-overview',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/statecrafting/oap-bootstrap',
            },
            {
              label: 'Open Agentic Platform',
              href: 'https://github.com/statecrafting/open-agentic-platform',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'SOPS',
              href: 'https://github.com/getsops/sops',
            },
            {
              label: 'age',
              href: 'https://github.com/FiloSottile/age',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} The oap-bootstrap Authors. Apache-2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['go', 'bash', 'json', 'yaml', 'toml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'factory-encore',
  tagline: 'Separate the process of building software from the technology that ships it.',
  favicon: 'img/favicon.ico',

  url: 'https://stagecraft-ing.github.io',
  baseUrl: '/factory-encore/',
  organizationName: 'stagecraft-ing',
  projectName: 'factory-encore',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/docs',
          editUrl: 'https://github.com/stagecraft-ing/factory-encore/tree/main/website/',
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
      title: 'factory-encore',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/stagecraft-ing/factory-encore',
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
              to: '/docs/getting-started/overview',
            },
            {
              label: 'Concepts',
              to: '/docs/concepts/three-layer-architecture',
            },
            {
              label: 'Contract Schemas',
              to: '/docs/reference/contract-schemas',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/stagecraft-ing/factory-encore',
            },
            {
              label: 'Open Agentic Platform',
              href: 'https://github.com/stagecraft-ing/open-agentic-platform',
            },
            {
              label: 'template-encore',
              href: 'https://github.com/stagecraft-ing/template-encore',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Use with Claude Code',
              to: '/docs/claude-code/agents-skills-rules',
            },
            {
              label: 'spec-spine (npm)',
              href: 'https://www.npmjs.com/package/spec-spine',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} The factory-encore Authors. Apache-2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'toml', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

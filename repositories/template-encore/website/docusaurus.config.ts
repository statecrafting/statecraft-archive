import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'acme-vue-encore',
  tagline: 'Spec-governed Vue 3 and Encore.ts reference app with built-in auth.',
  favicon: 'img/favicon.ico',

  url: 'https://statecrafting.github.io',
  baseUrl: '/template-encore/',

  organizationName: 'statecrafting',
  projectName: 'template-encore',

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
            'https://github.com/statecrafting/template-encore/tree/main/website/',
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
      title: 'acme-vue-encore',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/statecrafting/template-encore',
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
              label: 'Architecture',
              to: '/docs/concepts/architecture-overview',
            },
            {
              label: 'Deployment',
              to: '/docs/guides/deployment',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/statecrafting/template-encore',
            },
            {
              label: 'Open Agentic Platform',
              href: 'https://github.com/statecrafting/open-agentic-platform',
            },
            {
              label: 'factory-encore (the generator)',
              href: 'https://github.com/statecrafting/factory-encore',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Use with Claude Code',
              to: '/docs/use-with-claude-code/agentic-surface',
            },
            {
              label: 'Encore.ts docs',
              href: 'https://encore.dev/docs/ts',
            },
            {
              label: 'spec-spine (npm)',
              href: 'https://www.npmjs.com/package/spec-spine',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} The acme-vue-encore Authors. Apache-2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'sql', 'toml', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

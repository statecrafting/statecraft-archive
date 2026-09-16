import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Open Agentic Platform',
  tagline: 'A governed operating system for AI-native software delivery.',
  favicon: 'img/favicon.ico',

  url: 'https://statecrafting.github.io',
  baseUrl: '/open-agentic-platform/',

  organizationName: 'statecrafting',
  projectName: 'open-agentic-platform',

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
            'https://github.com/statecrafting/open-agentic-platform/tree/main/website/',
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
      title: 'Open Agentic Platform',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/statecrafting/open-agentic-platform',
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
              to: '/docs/getting-started/installation',
            },
            {
              label: 'The Governed Model',
              to: '/docs/concepts/the-governed-model',
            },
            {
              label: 'Use with Claude Code',
              to: '/docs/use-with-claude-code/overview',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/statecrafting/open-agentic-platform',
            },
            {
              label: 'spec-spine CLI (crates.io)',
              href: 'https://crates.io/crates/spec-spine-cli',
            },
            {
              label: 'Releases',
              href: 'https://github.com/statecrafting/open-agentic-platform/releases',
            },
          ],
        },
        {
          title: 'Ecosystem',
          items: [
            {
              label: 'factory-encore',
              href: 'https://github.com/statecrafting/factory-encore',
            },
            {
              label: 'template-encore',
              href: 'https://github.com/statecrafting/template-encore',
            },
            {
              label: 'oap-bootstrap',
              href: 'https://github.com/statecrafting/oap-bootstrap',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} The Open Agentic Platform Authors. AGPL-3.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['rust', 'toml', 'bash', 'json', 'yaml', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

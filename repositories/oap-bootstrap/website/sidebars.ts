import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/intro',
        'getting-started/prerequisites',
        'getting-started/quickstart',
        'getting-started/status-and-scope',
      ],
    },
    {
      type: 'category',
      label: 'Concepts (How It Works)',
      items: [
        'concepts/phase-model',
        'concepts/config-and-provenance',
        'concepts/secrets-at-rest',
        'concepts/github-app-and-identity',
      ],
    },
    {
      type: 'category',
      label: 'CLI Reference',
      items: [
        'cli/commands-overview',
        'cli/command-reference',
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      items: [
        'operations/troubleshooting',
      ],
    },
    {
      type: 'category',
      label: 'Project',
      items: [
        'project/governance',
      ],
    },
  ],
};

export default sidebars;

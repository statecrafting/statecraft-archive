import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/overview',
        'getting-started/prerequisites',
        'getting-started/quick-start',
        'getting-started/project-structure',
      ],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture-overview',
        'concepts/backend-services',
        'concepts/authentication-model',
        'concepts/bff-gateway',
        'concepts/security-invariants',
        'concepts/frontend-architecture',
        'concepts/data-and-persistence',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/development-workflow',
        'guides/auth-setup',
        'guides/deployment',
        'guides/testing',
        'guides/scaffolding-features',
        'guides/troubleshooting',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/api-endpoints',
        'reference/configuration',
        'reference/cli-and-scripts',
        'reference/encore-ts-reference',
        'reference/custom-dockerfile',
        'reference/placeholders',
      ],
    },
    {
      type: 'category',
      label: 'Governance',
      items: [
        'governance/spec-spine-overview',
        'governance/spec-corpus',
      ],
    },
    {
      type: 'category',
      label: 'Use with Claude Code',
      items: [
        'use-with-claude-code/agentic-surface',
        'use-with-claude-code/agents-and-skills',
        'use-with-claude-code/config-governance',
      ],
    },
    {
      type: 'category',
      label: 'Project',
      items: [
        'meta/contributing',
        'meta/security',
      ],
    },
  ],
};

export default sidebars;

import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/overview',
        'getting-started/quickstart',
      ],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/three-layer-architecture',
        'concepts/the-pipeline-and-gates',
        'concepts/bounded-context-agents',
        'concepts/build-specification',
        'concepts/lean-baseline-compose',
        'concepts/governance-kernel',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/contract-schemas',
        'reference/process-stages',
        'reference/process-agents',
        'reference/adapter-manifest',
        'reference/generator-cli',
        'reference/module-catalog',
        'reference/specs',
      ],
    },
    {
      type: 'category',
      label: 'Configuration',
      items: [
        'configuration/spec-spine-toml',
        'configuration/lockstep',
        'configuration/ci-and-gates',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/generate-and-run-an-app',
        'guides/add-or-remove-a-module',
        'guides/author-an-adapter',
      ],
    },
    {
      type: 'category',
      label: 'Use with Claude Code',
      items: [
        'claude-code/agents-skills-rules',
        'claude-code/init-and-governed-reads',
      ],
    },
    {
      type: 'doc',
      id: 'faq-troubleshooting',
      label: 'FAQ / Troubleshooting',
    },
  ],
};

export default sidebars;

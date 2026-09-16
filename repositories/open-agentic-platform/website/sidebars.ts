import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/introduction',
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/repository-tour',
      ],
    },
    {
      type: 'category',
      label: 'Concepts (The Governed Model)',
      items: [
        'concepts/the-governed-model',
        'concepts/spec-spine',
        'concepts/the-relationship-graph',
        'concepts/coupling-gate',
        'concepts/constitution-and-principles',
        'concepts/derived-machine-truth',
        'concepts/policy-kernel-and-safety-tiers',
        'concepts/governance-certificate',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/three-layer-overview',
        'architecture/spec-spine-toolchain',
        'architecture/factory-pipeline',
        'architecture/orchestrator',
        'architecture/crates-overview',
        'architecture/trust-fabric',
      ],
    },
    {
      type: 'category',
      label: 'Spec Spine Workflow',
      items: [
        'spec-spine-workflow/authoring-a-spec',
        'spec-spine-workflow/lifecycle-and-status',
        'spec-spine-workflow/compile-and-registry',
        'spec-spine-workflow/codebase-index',
        'spec-spine-workflow/querying-the-registry',
        'spec-spine-workflow/amendments-and-supersession',
      ],
    },
    {
      type: 'category',
      label: 'Platform (Control Plane)',
      items: [
        'platform/statecraft-service',
        'platform/deployd-api',
        'platform/identity-rauthy',
        'platform/factory-adapters',
        'platform/deployment-and-infra',
      ],
    },
    {
      type: 'category',
      label: 'OPC Desktop',
      items: [
        'opc-desktop/overview',
        'opc-desktop/axiomregent-mcp',
        'opc-desktop/factory-panel',
      ],
    },
    {
      type: 'category',
      label: 'Build and CI',
      items: [
        'build-and-ci/makefile-flows',
        'build-and-ci/the-gates',
        'build-and-ci/release-and-attestation',
      ],
    },
    {
      type: 'category',
      label: 'Use with Claude Code',
      items: [
        'use-with-claude-code/overview',
        'use-with-claude-code/agents',
        'use-with-claude-code/skills',
        'use-with-claude-code/rules-and-governed-loop',
      ],
    },
    {
      type: 'category',
      label: 'Security',
      items: [
        'security/owasp-agentic-top-10-2026',
        'security/certificate-and-provenance-verification',
      ],
    },
    {
      type: 'category',
      label: 'Contributing',
      items: [
        'contributing/index',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/crates-and-tools',
        'reference/faq',
      ],
    },
  ],
};

export default sidebars;

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegistrySpecFollowUp } from '../RegistrySpecFollowUp';

describe('RegistrySpecFollowUp', () => {
  it('renders follow-up and calls onViewSpec with resolved path', () => {
    const onView = vi.fn();
    render(
      <RegistrySpecFollowUp
        repoRoot="/repo"
        registry={{
          status: 'ok',
          path: '/r',
          summary: {
            featureCount: 1,
            validationPassed: true,
            violationsCount: 0,
            statusCounts: {},
            featureSummaries: [{ id: 'a', title: 'Feat', specPath: 'specs/a/spec.md' }],
          },
        }}
        onViewSpec={onView}
      />
    );
    expect(screen.getByTestId('registry-spec-follow-up')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /View spec: Feat/ }));
    expect(onView).toHaveBeenCalledWith('/repo/specs/a/spec.md', 'Feat');
  });

  it('renders nothing when registry has no feature summaries', () => {
    const { container } = render(
      <RegistrySpecFollowUp
        repoRoot="/r"
        registry={{
          status: 'ok',
          path: '/p',
          summary: {
            featureCount: 0,
            validationPassed: true,
            violationsCount: 0,
            statusCounts: {},
          },
        }}
        onViewSpec={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

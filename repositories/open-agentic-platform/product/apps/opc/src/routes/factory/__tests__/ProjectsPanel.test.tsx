import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectsPanel, type ProjectCatalogEntry } from '../ProjectsPanel';

afterEach(() => cleanup());

function makeEntry(overrides: Partial<ProjectCatalogEntry> = {}): ProjectCatalogEntry {
  return {
    projectId: overrides.projectId ?? 'p-1',
    orgId: 'org-1',
    name: overrides.name ?? 'Portal',
    slug: overrides.slug ?? 'portal',
    description: overrides.description ?? '',
    factoryAdapterId: overrides.factoryAdapterId ?? 'adap-1',
    detectionLevel: overrides.detectionLevel ?? 'acp_produced',
    repo: overrides.repo ?? {
      githubOrg: 'acme',
      repoName: overrides.slug ?? 'portal',
      defaultBranch: 'main',
      cloneUrl: 'https://github.com/acme/portal.git',
      htmlUrl: 'https://github.com/acme/portal',
    },
    opcDeepLink: 'opc://project/open?project_id=p-1',
    updatedAt: '2026-04-23T00:00:00Z',
    ...overrides,
  };
}

describe('ProjectsPanel', () => {
  it('renders empty-state hint when no projects are available', () => {
    render(<ProjectsPanel projects={[]} onOpen={() => {}} />);
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
  });

  it('lists projects sorted case-insensitively by name', () => {
    render(
      <ProjectsPanel
        projects={[
          makeEntry({ projectId: 'p-2', name: 'Zulu' }),
          makeEntry({ projectId: 'p-1', name: 'alpha' }),
        ]}
        onOpen={() => {}}
      />
    );
    const names = screen
      .getAllByRole('button', { name: /Clone & open|Open/ })
      .map((btn) => btn.closest('div')?.querySelector('.text-sm')?.textContent);
    // Simpler: check that alpha card appears before Zulu card in the DOM order.
    const html = document.body.innerHTML;
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('Zulu'));
    expect(names.length).toBe(2);
  });

  it('invokes onClone when a remote-only project is opened and falls through to onOpen when local', () => {
    const onOpen = vi.fn();
    const onClone = vi.fn();
    render(
      <ProjectsPanel
        projects={[makeEntry({ projectId: 'remote' })]}
        onOpen={onOpen}
        onClone={onClone}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Clone & open/ }));
    expect(onClone).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    cleanup();

    onOpen.mockReset();
    onClone.mockReset();
    render(
      <ProjectsPanel
        projects={[makeEntry({ projectId: 'local', localPath: '/tmp/local' })]}
        onOpen={onOpen}
        onClone={onClone}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Open$/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClone).not.toHaveBeenCalled();
  });

  it('surfaces detection level as a badge for factory projects only', () => {
    render(
      <ProjectsPanel
        projects={[
          makeEntry({ projectId: 'a', detectionLevel: 'acp_produced' }),
          makeEntry({ projectId: 'b', detectionLevel: 'not_factory' }),
        ]}
        onOpen={() => {}}
      />
    );
    expect(screen.getByText('ACP')).toBeInTheDocument();
    expect(screen.queryByText('Not factory')).toBeNull();
  });
});

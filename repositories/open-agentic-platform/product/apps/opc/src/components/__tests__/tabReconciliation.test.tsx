// Spec 180 — OPC shell codification, §3.1 Tab-list reconciliation.
//
// Tier 1 structural invariants on the tab/IPC seam. These are the
// enforceable boolean assertions FR-T1..FR-T3 describe:
//
//   FR-T1  TabContent must NOT wrap the mapped panel list in
//          <AnimatePresence mode="wait">. mode="wait" gates
//          reconciliation of the whole set behind one sibling's exit.
//   FR-T2  Per-tab panels must be memoized via React.memo with a
//          comparator that depends on at minimum tab.id and isActive.
//   FR-T3  A single-panel state change must not change the object
//          identity of sibling tabs (so React can skip them).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { tabPanelPropsAreEqual, tabItemPropsAreEqual } from '@/components/tabPanelMemo';
import { TabProvider, useTabContext, type Tab } from '@/contexts/TabContext';

const here = path.dirname(fileURLToPath(import.meta.url));
const tabContentSource = readFileSync(
  path.resolve(here, '../TabContent.tsx'),
  'utf8',
);
const tabManagerSource = readFileSync(
  path.resolve(here, '../TabManager.tsx'),
  'utf8',
);

// Build a Tab with a controllable identity/updatedAt for comparator probing.
function makeTab(id: string, updatedAt: Date): Pick<Tab, 'id' | 'updatedAt'> {
  return { id, updatedAt };
}

describe('FR-T1 — no AnimatePresence mode="wait" gating the tab list', () => {
  it('TabContent.tsx contains no mode="wait" reconciliation gate', () => {
    expect(tabContentSource).not.toMatch(/mode\s*=\s*["']wait["']/);
  });

  it('TabContent.tsx renders the mapped tab list directly (no AnimatePresence wrapper)', () => {
    // AnimatePresence around the mapped set is the prohibited shape; if the
    // import is gone the wrapper is gone.
    expect(tabContentSource).not.toMatch(/<AnimatePresence\b/);
  });
});

describe('FR-T2 — per-tab panels memoized with a tab.id + isActive comparator', () => {
  it('TabContent.tsx wraps the panel in React.memo with the shared comparator', () => {
    expect(tabContentSource).toMatch(/React\.memo\(/);
    expect(tabContentSource).toMatch(/tabPanelPropsAreEqual/);
  });

  it('comparator skips re-render when id, isActive and updatedAt are unchanged', () => {
    const at = new Date('2026-05-31T00:00:00Z');
    const same = tabPanelPropsAreEqual(
      { tab: makeTab('tab-a', at) as Tab, isActive: true },
      { tab: makeTab('tab-a', at) as Tab, isActive: true },
    );
    expect(same).toBe(true);
  });

  it('comparator depends on tab.id (different id => re-render)', () => {
    const at = new Date('2026-05-31T00:00:00Z');
    const equal = tabPanelPropsAreEqual(
      { tab: makeTab('tab-a', at) as Tab, isActive: true },
      { tab: makeTab('tab-b', at) as Tab, isActive: true },
    );
    expect(equal).toBe(false);
  });

  it('comparator depends on isActive (active flip => re-render)', () => {
    const at = new Date('2026-05-31T00:00:00Z');
    const equal = tabPanelPropsAreEqual(
      { tab: makeTab('tab-a', at) as Tab, isActive: true },
      { tab: makeTab('tab-a', at) as Tab, isActive: false },
    );
    expect(equal).toBe(false);
  });

  it('comparator re-renders when the tab content changes (updatedAt bumped)', () => {
    const equal = tabPanelPropsAreEqual(
      { tab: makeTab('tab-a', new Date('2026-05-31T00:00:00Z')) as Tab, isActive: true },
      { tab: makeTab('tab-a', new Date('2026-05-31T00:00:01Z')) as Tab, isActive: true },
    );
    expect(equal).toBe(false);
  });
});

describe('FR-T2 — tab-strip items (TabManager) are memoized', () => {
  it('TabManager.tsx wraps the strip item in React.memo with the shared comparator', () => {
    expect(tabManagerSource).toMatch(/React\.memo\(/);
    expect(tabManagerSource).toMatch(/tabItemPropsAreEqual/);
  });

  it('comparator skips re-render when id, isActive, isDragging and updatedAt are unchanged', () => {
    const at = new Date('2026-05-31T00:00:00Z');
    expect(
      tabItemPropsAreEqual(
        { tab: makeTab('tab-a', at) as Tab, isActive: false, isDragging: false },
        { tab: makeTab('tab-a', at) as Tab, isActive: false, isDragging: false },
      ),
    ).toBe(true);
  });

  it('comparator depends on tab.id, isActive and isDragging', () => {
    const at = new Date('2026-05-31T00:00:00Z');
    expect(
      tabItemPropsAreEqual(
        { tab: makeTab('tab-a', at) as Tab, isActive: false },
        { tab: makeTab('tab-b', at) as Tab, isActive: false },
      ),
    ).toBe(false);
    expect(
      tabItemPropsAreEqual(
        { tab: makeTab('tab-a', at) as Tab, isActive: false },
        { tab: makeTab('tab-a', at) as Tab, isActive: true },
      ),
    ).toBe(false);
    expect(
      tabItemPropsAreEqual(
        { tab: makeTab('tab-a', at) as Tab, isActive: false, isDragging: false },
        { tab: makeTab('tab-a', at) as Tab, isActive: false, isDragging: true },
      ),
    ).toBe(false);
  });
});

describe('FR-T3 — single-panel update preserves sibling identity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('updating one tab does not change the object reference of other tabs', async () => {
    const { result } = renderHook(() => useTabContext(), { wrapper: TabProvider });

    // Let the async mount effect seed the default tab first.
    await waitFor(() => expect(result.current.tabs.length).toBeGreaterThanOrEqual(1));

    let idA = '';
    let idB = '';
    act(() => {
      idA = result.current.addTab({
        type: 'projects', title: 'A', status: 'idle', hasUnsavedChanges: false,
      });
    });
    act(() => {
      idB = result.current.addTab({
        type: 'projects', title: 'B', status: 'idle', hasUnsavedChanges: false,
      });
    });

    const siblingBefore = result.current.tabs.find((t) => t.id === idB);
    const updatedBefore = result.current.tabs.find((t) => t.id === idA);
    expect(siblingBefore).toBeDefined();

    act(() => {
      result.current.updateTab(idA, { title: 'A-renamed' });
    });

    const siblingAfter = result.current.tabs.find((t) => t.id === idB);
    const updatedAfter = result.current.tabs.find((t) => t.id === idA);

    // Sibling identity preserved => React.memo (FR-T2) can skip it.
    expect(siblingAfter).toBe(siblingBefore);
    // The updated tab itself got a fresh object (and bumped updatedAt).
    expect(updatedAfter).not.toBe(updatedBefore);
    expect(updatedAfter!.title).toBe('A-renamed');
  });
});

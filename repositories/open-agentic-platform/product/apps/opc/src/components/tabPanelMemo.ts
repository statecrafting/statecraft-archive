// Spec 180 §3.1 FR-T2 — per-tab panel memoization comparator.
//
// Extracted as a pure module so the invariant is unit-testable without
// mounting the heavy TabContent tree. React.memo skips a re-render when
// this returns true.
//
// The comparator depends on at minimum `tab.id` and `isActive` (the
// FR-T2 floor) and additionally on `tab.updatedAt`: TabContext.updateTab
// stamps a fresh `updatedAt` Date on every mutation, so an unchanged
// reference means the tab's content is unchanged and the panel can be
// skipped — while a content change re-renders the affected panel only.
import type { Tab } from '@/contexts/TabContext';

export interface TabPanelComparableProps {
  tab: Pick<Tab, 'id' | 'updatedAt'>;
  isActive: boolean;
}

export function tabPanelPropsAreEqual(
  prev: TabPanelComparableProps,
  next: TabPanelComparableProps,
): boolean {
  return (
    prev.tab.id === next.tab.id &&
    prev.isActive === next.isActive &&
    prev.tab.updatedAt === next.tab.updatedAt
  );
}

// Spec 180 §3.3 — FR-T2 also binds on TabManager.tsx, whose per-tab strip
// item (TabItem) is rendered once per tab. Same comparator floor (tab.id +
// isActive), plus `isDragging` (a render-affecting strip-local prop) and
// `updatedAt` as the content-change marker. Callback props (onClose, onClick,
// setDraggedTabId) are deliberately excluded: they affect behaviour, not
// rendered output, so excluding them keeps memoization effective even when
// the parent recreates the handlers each render.
export interface TabStripItemComparableProps {
  tab: Pick<Tab, 'id' | 'updatedAt'>;
  isActive: boolean;
  isDragging?: boolean;
}

export function tabItemPropsAreEqual(
  prev: TabStripItemComparableProps,
  next: TabStripItemComparableProps,
): boolean {
  return (
    prev.tab.id === next.tab.id &&
    prev.isActive === next.isActive &&
    (prev.isDragging ?? false) === (next.isDragging ?? false) &&
    prev.tab.updatedAt === next.tab.updatedAt
  );
}

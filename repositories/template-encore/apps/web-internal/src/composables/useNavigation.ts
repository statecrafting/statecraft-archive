import { computed, type ComputedRef } from 'vue'

export interface SidebarNavItem {
  id: string
  label: string | (() => string)
  to: string
  slot: 'primary' | 'secondary' | 'account'
  icon?: string
  show?: () => boolean
  priority?: number
  badge?: number | (() => number)
}

let items: SidebarNavItem[] = []

export function registerNavItem(item: SidebarNavItem): void {
  items.push(item)
}

export function useNavigation(): {
  primaryItems: ComputedRef<SidebarNavItem[]>
  secondaryItems: ComputedRef<SidebarNavItem[]>
  accountItems: ComputedRef<SidebarNavItem[]>
} {
  const filter = (slot: SidebarNavItem['slot']) =>
    computed(() =>
      items
        .filter((i) => i.slot === slot && (!i.show || i.show()))
        .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100)),
    )
  return {
    primaryItems: filter('primary'),
    secondaryItems: filter('secondary'),
    accountItems: filter('account'),
  }
}

export function resolveLabel(label: string | (() => string)): string {
  return typeof label === 'function' ? label() : label
}

export function resolveBadge(badge?: number | (() => number)): number | undefined {
  if (badge === undefined) return undefined
  return typeof badge === 'function' ? badge() : badge
}

/** Reset navigation items — for testing only */
export function _resetForTesting(): void {
  items = []
}

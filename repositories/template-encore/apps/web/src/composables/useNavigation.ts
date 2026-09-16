import { computed, type ComputedRef } from 'vue'

export interface NavItemChild {
  label: string
  to?: string
  action?: () => Promise<void> | void
}

export interface NavItem {
  id: string
  label: string | (() => string)
  to: string
  position: 'left' | 'right'
  show?: () => boolean
  priority?: number
  type?: 'link' | 'user-menu'
  children?: NavItemChild[]
}

const items: NavItem[] = []

export function registerNavItem(item: NavItem): void {
  items.push(item)
}

export function useNavigation(): {
  leftItems: ComputedRef<NavItem[]>
  rightItems: ComputedRef<NavItem[]>
} {
  const filter = (pos: 'left' | 'right') =>
    computed(() =>
      items
        .filter((i) => i.position === pos && (!i.show || i.show()))
        .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100)),
    )
  return { leftItems: filter('left'), rightItems: filter('right') }
}

export function resolveLabel(label: string | (() => string)): string {
  return typeof label === 'function' ? label() : label
}

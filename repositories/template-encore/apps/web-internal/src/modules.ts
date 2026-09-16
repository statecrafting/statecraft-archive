/**
 * Web-Internal Module Loader
 * DO NOT EDIT MANUALLY — managed by module orchestrator
 */

import { registerNavItem } from './composables/useNavigation'

export function registerAllWebModules(): void {
  // Primary navigation (main sidebar section)
  registerNavItem({
    id: 'nav-dashboard',
    label: 'Dashboard',
    to: '/',
    slot: 'primary',
    icon: 'home',
    priority: 10,
  })

  // Account navigation (bottom sidebar section)
  registerNavItem({
    id: 'nav-profile',
    label: 'My Profile',
    to: '/profile',
    slot: 'account',
    icon: 'person',
    priority: 10,
  })
}

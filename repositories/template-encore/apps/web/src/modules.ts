/**
 * Web Module Loader
 * DO NOT EDIT MANUALLY — managed by module orchestrator
 */

import { registerNavItem } from './composables/useNavigation'

export function registerAllWebModules(): void {
  // Base navigation
  registerNavItem({ id: 'nav-home', label: 'Home', to: '/', position: 'left', priority: 10 })
  registerNavItem({ id: 'nav-about', label: 'About', to: '/about', position: 'left', priority: 20 })
}

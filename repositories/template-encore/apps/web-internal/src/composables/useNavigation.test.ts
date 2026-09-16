import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerNavItem,
  useNavigation,
  resolveLabel,
  resolveBadge,
  _resetForTesting,
} from './useNavigation'

describe('useNavigation', () => {
  beforeEach(() => {
    _resetForTesting()
  })

  describe('registerNavItem', () => {
    it('registers items and makes them available via useNavigation', () => {
      registerNavItem({
        id: 'test-1',
        label: 'Dashboard',
        to: '/',
        slot: 'primary',
        icon: 'home',
      })

      const { primaryItems } = useNavigation()
      expect(primaryItems.value).toHaveLength(1)
      expect(primaryItems.value[0].id).toBe('test-1')
    })
  })

  describe('slot filtering', () => {
    beforeEach(() => {
      registerNavItem({ id: 'primary-1', label: 'Dashboard', to: '/', slot: 'primary', icon: 'home' })
      registerNavItem({ id: 'primary-2', label: 'Reports', to: '/reports', slot: 'primary', icon: 'stats-chart' })
      registerNavItem({ id: 'secondary-1', label: 'Notifications', to: '/notifications', slot: 'secondary', icon: 'notifications', badge: 3 })
      registerNavItem({ id: 'account-1', label: 'My Profile', to: '/profile', slot: 'account' })
      registerNavItem({ id: 'account-2', label: 'Settings', to: '/settings', slot: 'account' })
    })

    it('filters primary items', () => {
      const { primaryItems } = useNavigation()
      expect(primaryItems.value).toHaveLength(2)
      expect(primaryItems.value.map((i) => i.id)).toEqual(['primary-1', 'primary-2'])
    })

    it('filters secondary items', () => {
      const { secondaryItems } = useNavigation()
      expect(secondaryItems.value).toHaveLength(1)
      expect(secondaryItems.value[0].id).toBe('secondary-1')
    })

    it('filters account items', () => {
      const { accountItems } = useNavigation()
      expect(accountItems.value).toHaveLength(2)
      expect(accountItems.value.map((i) => i.id)).toEqual(['account-1', 'account-2'])
    })
  })

  describe('priority sorting', () => {
    it('sorts items by priority within each slot', () => {
      registerNavItem({ id: 'b', label: 'Second', to: '/b', slot: 'primary', priority: 20 })
      registerNavItem({ id: 'a', label: 'First', to: '/a', slot: 'primary', priority: 10 })
      registerNavItem({ id: 'c', label: 'Third', to: '/c', slot: 'primary', priority: 30 })

      const { primaryItems } = useNavigation()
      expect(primaryItems.value.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    })

    it('uses default priority of 100 when not specified', () => {
      registerNavItem({ id: 'explicit', label: 'Explicit', to: '/a', slot: 'primary', priority: 50 })
      registerNavItem({ id: 'default', label: 'Default', to: '/b', slot: 'primary' })

      const { primaryItems } = useNavigation()
      expect(primaryItems.value[0].id).toBe('explicit')
      expect(primaryItems.value[1].id).toBe('default')
    })
  })

  describe('show() conditional filtering', () => {
    it('hides items when show() returns false', () => {
      registerNavItem({ id: 'visible', label: 'Visible', to: '/a', slot: 'primary' })
      registerNavItem({ id: 'hidden', label: 'Hidden', to: '/b', slot: 'primary', show: () => false })

      const { primaryItems } = useNavigation()
      expect(primaryItems.value).toHaveLength(1)
      expect(primaryItems.value[0].id).toBe('visible')
    })

    it('shows items when show() returns true', () => {
      registerNavItem({ id: 'item', label: 'Item', to: '/a', slot: 'primary', show: () => true })

      const { primaryItems } = useNavigation()
      expect(primaryItems.value).toHaveLength(1)
    })
  })

  describe('resolveLabel', () => {
    it('returns string labels as-is', () => {
      expect(resolveLabel('Dashboard')).toBe('Dashboard')
    })

    it('calls function labels and returns result', () => {
      expect(resolveLabel(() => 'Dynamic Label')).toBe('Dynamic Label')
    })
  })

  describe('resolveBadge', () => {
    it('returns undefined for undefined badge', () => {
      expect(resolveBadge(undefined)).toBeUndefined()
    })

    it('returns number badges as-is', () => {
      expect(resolveBadge(5)).toBe(5)
    })

    it('calls function badges and returns result', () => {
      expect(resolveBadge(() => 3)).toBe(3)
    })

    it('returns 0 for zero badge', () => {
      expect(resolveBadge(0)).toBe(0)
    })
  })
})

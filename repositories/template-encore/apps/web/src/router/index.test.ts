import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be defined before the module under test is imported.
// vi.mock is hoisted so import order in the file does not matter.

const mockAuthStore = {
  user: null as Record<string, unknown> | null,
  isAuthenticated: false,
  fetchUser: vi.fn().mockResolvedValue(null),
}

vi.mock('../stores/auth.store', () => ({
  useAuthStore: vi.fn(() => mockAuthStore),
}))

vi.mock('../modules', () => ({
  registerAllWebModules: vi.fn(),
}))

vi.mock('./registry', () => ({
  getRouterPlugins: vi.fn(() => []),
}))

// Replace createWebHistory with createMemoryHistory so tests don't need a real browser URL
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return { ...actual, createWebHistory: () => actual.createMemoryHistory() }
})

import router from './index.js'

function setAuthenticatedUser() {
  mockAuthStore.user = { id: 'user-1', email: 'dev@example.com' }
  mockAuthStore.isAuthenticated = true
}

function setUnauthenticatedUser() {
  mockAuthStore.user = null
  mockAuthStore.isAuthenticated = false
}

beforeEach(async () => {
  vi.clearAllMocks()
  setUnauthenticatedUser()
  mockAuthStore.fetchUser.mockResolvedValue(null)
  await router.push('/')
  await router.isReady()
})

// ─── fetchUser on navigation ───────────────────────────────────────────

describe('fetchUser behaviour', () => {
  it('should call fetchUser when no user is set', async () => {
    await router.push('/login')
    expect(mockAuthStore.fetchUser).toHaveBeenCalled()
  })

  it('should not call fetchUser when user is already set', async () => {
    setAuthenticatedUser()
    mockAuthStore.fetchUser.mockClear()

    await router.push('/profile')

    expect(mockAuthStore.fetchUser).not.toHaveBeenCalled()
  })
})

// ─── requiresAuth guard ────────────────────────────────────────────────

describe('requiresAuth guard', () => {
  it('should redirect to login with ?redirect when unauthenticated user accesses /profile', async () => {
    await router.push('/profile')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/profile')
  })

  it('should allow authenticated user to access /profile', async () => {
    setAuthenticatedUser()

    await router.push('/profile')

    expect(router.currentRoute.value.name).toBe('profile')
  })
})

// ─── guestOnly guard ──────────────────────────────────────────────────

describe('guestOnly guard', () => {
  it('should redirect authenticated user away from /login to /profile', async () => {
    setAuthenticatedUser()

    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('profile')
  })

  it('should allow unauthenticated user to access /login', async () => {
    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('login')
  })
})

// ─── public routes ────────────────────────────────────────────────────

describe('public routes', () => {
  it('should allow unauthenticated access to / (home)', async () => {
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('should allow unauthenticated access to /about', async () => {
    await router.push('/about')

    expect(router.currentRoute.value.name).toBe('about')
  })
})

// ─── document.title ───────────────────────────────────────────────────

describe('document.title', () => {
  it('should set document.title from route meta after navigation', async () => {
    setAuthenticatedUser()

    await router.push('/profile')

    expect(document.title).toBe('My Profile - Application Template')
  })
})

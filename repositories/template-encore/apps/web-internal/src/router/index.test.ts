import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be defined before the module under test is imported.
// vi.mock is hoisted so import order in the file does not matter.

const mockAuthStore = {
  user: null as Record<string, unknown> | null,
  isAuthenticated: false,
  loggingOut: false,
  fetchUser: vi.fn().mockResolvedValue(null),
  clearLoggingOut: vi.fn(),
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
  mockAuthStore.loggingOut = false
}

beforeEach(async () => {
  vi.clearAllMocks()
  setUnauthenticatedUser()
  mockAuthStore.fetchUser.mockResolvedValue(null)
  // Return to login so each test starts from a clean slate
  await router.push('/login')
  await router.isReady()
})

// ─── fetchUser on navigation ───────────────────────────────────────────

describe('fetchUser behaviour', () => {
  it('should call fetchUser when user is null and not logging out', async () => {
    await router.push('/login')
    expect(mockAuthStore.fetchUser).toHaveBeenCalled()
  })

  it('should not call fetchUser when user is already set', async () => {
    setAuthenticatedUser()
    mockAuthStore.fetchUser.mockClear()

    await router.push('/')

    expect(mockAuthStore.fetchUser).not.toHaveBeenCalled()
  })

  it('AUTH-010: should NOT call fetchUser during logout (loggingOut=true)', async () => {
    mockAuthStore.user = null
    mockAuthStore.loggingOut = true
    mockAuthStore.fetchUser.mockClear()

    await router.push('/login')

    expect(mockAuthStore.fetchUser).not.toHaveBeenCalled()
  })
})

// ─── requiresAuth — all routes default to requiring auth ──────────────

describe('requiresAuth guard (internal portal — auth required by default)', () => {
  it('should redirect to login when accessing / unauthenticated', async () => {
    setUnauthenticatedUser()

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/')
  })

  it('should redirect to login when accessing /profile unauthenticated', async () => {
    await router.push('/profile')

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('should allow authenticated user to access /', async () => {
    setAuthenticatedUser()

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('should allow authenticated user to access /profile', async () => {
    setAuthenticatedUser()

    await router.push('/profile')

    expect(router.currentRoute.value.name).toBe('profile')
  })
})

// ─── guestOnly guard ──────────────────────────────────────────────────

describe('guestOnly guard', () => {
  it('should redirect authenticated user away from /login to dashboard', async () => {
    setAuthenticatedUser()
    // Navigate to dashboard first so pushing /login is not a no-op (same-route dedup)
    await router.push('/')
    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('should allow unauthenticated user to access /login', async () => {
    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('login')
  })
})

// ─── afterEach — loggingOut cleared ───────────────────────────────────

describe('afterEach — clearLoggingOut', () => {
  it('should call clearLoggingOut after each navigation completes', async () => {
    setAuthenticatedUser()

    await router.push('/')

    expect(mockAuthStore.clearLoggingOut).toHaveBeenCalled()
  })
})

// ─── document.title ───────────────────────────────────────────────────

describe('document.title', () => {
  it('should set document.title from route meta after navigation', async () => {
    await router.push('/login')
    expect(document.title).toBe('Sign In - Internal Portal')
  })
})

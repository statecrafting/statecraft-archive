/**
 * Auth Store (Pinia) — Unit Tests
 *
 * Tests the authentication state management store.
 * Covers initial state, computed getters, and all actions:
 * fetchUser, login, logout, checkStatus.
 *
 * Axios is mocked to prevent real HTTP calls. Responses use the Encore-native
 * shapes (bare me/status, { code, message } errors), matching the backend.
 * Pinia is configured fresh for each test to isolate state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'

// Mock axios — all HTTP calls return controlled responses
vi.mock('axios', () => {
  const interceptors = {
    response: { use: vi.fn(() => 0), eject: vi.fn() },
    request: { use: vi.fn(() => 0), eject: vi.fn() },
  }
  return {
    default: {
      get: vi.fn(),
      post: vi.fn(),
      interceptors,
    },
  }
})

// Must import after vi.mock so the mock is in place
import { useAuthStore, type User } from './auth.store.js'

const MOCK_USER: User = {
  id: 'user-1',
  email: 'dev@example.com',
  name: 'Dev User',
  roles: ['admin', 'user'],
  attributes: { department: 'IT' },
}

// Encore GET /api/v1/auth/me — bare profile, no envelope.
const MOCK_ME = {
  id: 'user-1',
  email: 'dev@example.com',
  name: 'Dev User',
  roles: ['admin', 'user'],
  ssoProvider: 'mock',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-06-05T00:00:00.000Z',
}

// What fetchUser maps MOCK_ME into (the fields the SPA consumes).
const EXPECTED_USER: User = {
  id: 'user-1',
  email: 'dev@example.com',
  name: 'Dev User',
  roles: ['admin', 'user'],
}

beforeEach(() => {
  vi.clearAllMocks()
  // Fresh Pinia instance so each test starts with clean state
  setActivePinia(createPinia())
})

// ─── Initial state ─────────────────────────────────────────────────────

describe('initial state', () => {
  it('should start with user null, loading false, error null', () => {
    const store = useAuthStore()

    expect(store.user).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })
})

// ─── Computed getters ──────────────────────────────────────────────────

describe('isAuthenticated', () => {
  it('should return false when no user', () => {
    const store = useAuthStore()
    expect(store.isAuthenticated).toBe(false)
  })

  it('should return true when user is set', () => {
    const store = useAuthStore()
    store.user = MOCK_USER
    expect(store.isAuthenticated).toBe(true)
  })
})

describe('hasRole', () => {
  it('should return false when no user', () => {
    const store = useAuthStore()
    expect(store.hasRole('admin')).toBe(false)
  })

  it('should return true when user has matching role', () => {
    const store = useAuthStore()
    store.user = MOCK_USER
    expect(store.hasRole('admin')).toBe(true)
  })

  it('should return true when any role in array matches', () => {
    const store = useAuthStore()
    store.user = MOCK_USER
    expect(store.hasRole(['super-admin', 'user'])).toBe(true)
  })

  it('should return false when no role matches', () => {
    const store = useAuthStore()
    store.user = MOCK_USER
    expect(store.hasRole('super-admin')).toBe(false)
  })
})

// ─── fetchUser ─────────────────────────────────────────────────────────

describe('fetchUser', () => {
  it('should set user from the bare Encore me payload', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: MOCK_ME })

    const store = useAuthStore()
    const result = await store.fetchUser()

    expect(result).toEqual(EXPECTED_USER)
    expect(store.user).toEqual(EXPECTED_USER)
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('should clear user on 401 response without setting error', async () => {
    vi.mocked(axios.get).mockRejectedValue({
      response: { status: 401 },
    })

    const store = useAuthStore()
    store.user = MOCK_USER // pre-populate
    const result = await store.fetchUser()

    expect(result).toBeNull()
    expect(store.user).toBeNull()
    expect(store.error).toBeNull() // 401 is expected, not an error
  })

  it('should set error message on non-401 failure (Encore { message })', async () => {
    vi.mocked(axios.get).mockRejectedValue({
      response: { status: 500, data: { code: 'internal', message: 'Server error' } },
    })
    // Suppress console.error from the store
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = useAuthStore()
    const result = await store.fetchUser()

    expect(result).toBeNull()
    expect(store.error).toBe('Server error')
  })

  it('should deduplicate concurrent calls (return same promise)', async () => {
    let resolveCount = 0
    vi.mocked(axios.get).mockImplementation(() => {
      resolveCount++
      return Promise.resolve({ data: MOCK_ME })
    })

    const store = useAuthStore()
    // Fire two calls simultaneously
    const [result1, result2] = await Promise.all([store.fetchUser(), store.fetchUser()])

    // Both should get the same user, but axios.get called only once
    expect(result1).toEqual(EXPECTED_USER)
    expect(result2).toEqual(EXPECTED_USER)
    expect(resolveCount).toBe(1)
  })
})

// ─── logout ────────────────────────────────────────────────────────────

describe('logout', () => {
  it('should clear user on successful logout', async () => {
    // ensureCsrfToken() fetches the token first, then the logout POST.
    vi.mocked(axios.get).mockResolvedValue({ data: { token: 'csrf-1' } })
    vi.mocked(axios.post).mockResolvedValue({ data: { success: true } })

    const store = useAuthStore()
    store.user = MOCK_USER

    await store.logout()

    expect(store.user).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('should set error on logout failure (Encore { message })', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { token: 'csrf-1' } })
    vi.mocked(axios.post).mockRejectedValue({
      response: { data: { code: 'internal', message: 'Logout failed' } },
    })

    const store = useAuthStore()
    store.user = MOCK_USER

    await expect(store.logout()).rejects.toBeTruthy()
    expect(store.error).toBe('Logout failed')
  })

  it('clears the cached CSRF token on logout so the next mutation re-fetches it', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { token: 'csrf-1' } })
    vi.mocked(axios.post).mockResolvedValue({ data: { success: true } })

    const store = useAuthStore()
    store.user = MOCK_USER

    await store.logout()
    await store.logout()

    // ensureCsrfToken must hit /auth/csrf-token on each logout, because the
    // token is dropped after the first; a stale token is never replayed.
    const csrfGets = vi.mocked(axios.get).mock.calls.filter(
      ([url]) => url === '/api/v1/auth/csrf-token'
    )
    expect(csrfGets).toHaveLength(2)
  })

  it('rejects a javascript: redirect URL from the logout response (open-redirect guard)', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { token: 'csrf-1' } })
    vi.mocked(axios.post).mockResolvedValue({ data: { redirectUrl: 'javascript:alert(1)' } })

    const hrefSetter = vi.fn()
    vi.stubGlobal('location', {
      origin: 'http://localhost',
      set href(v: string) { hrefSetter(v) },
    })

    const store = useAuthStore()
    await store.logout()

    expect(hrefSetter).not.toHaveBeenCalledWith('javascript:alert(1)')
    vi.unstubAllGlobals()
  })

  it('follows a safe https: redirect URL from the logout response', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { token: 'csrf-1' } })
    vi.mocked(axios.post).mockResolvedValue({ data: { redirectUrl: 'https://idp.example.com/logout' } })

    const hrefSetter = vi.fn()
    vi.stubGlobal('location', {
      origin: 'http://localhost',
      set href(v: string) { hrefSetter(v) },
    })

    const store = useAuthStore()
    await store.logout()

    expect(hrefSetter).toHaveBeenCalledWith('https://idp.example.com/logout')
    vi.unstubAllGlobals()
  })
})

// ─── checkStatus ───────────────────────────────────────────────────────

describe('checkStatus', () => {
  it('should return the bare Encore status payload', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { authenticated: true, drivers: ['mock'] },
    })

    const store = useAuthStore()
    const status = await store.checkStatus()

    expect(status).toEqual({ authenticated: true, drivers: ['mock'] })
  })

  it('should return { authenticated: false } on error', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('network error'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = useAuthStore()
    const status = await store.checkStatus()

    expect(status).toEqual({ authenticated: false, drivers: [] })
  })
})

// ─── ensureCsrfToken concurrent dedup ──────────────────────────────────

describe('ensureCsrfToken', () => {
  it('deduplicates concurrent callers: two simultaneous logout calls trigger only one GET /auth/csrf-token', async () => {
    let csrfGetCount = 0
    vi.mocked(axios.get).mockImplementation((url) => {
      if (url === '/api/v1/auth/csrf-token') csrfGetCount++
      return Promise.resolve({ data: { token: 'csrf-1' } })
    })
    vi.mocked(axios.post).mockResolvedValue({ data: { success: true } })

    const store = useAuthStore()
    // Fire two concurrent logouts; both reach ensureCsrfToken before either resolves.
    await Promise.all([store.logout(), store.logout()])

    // The second caller must have reused the in-flight promise, not issued a new GET.
    expect(csrfGetCount).toBe(1)
  })
})

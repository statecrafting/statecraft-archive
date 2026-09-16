/**
 * Auth Store - Pinia
 *
 * Manages authentication state and provides auth-related actions.
 *
 * Talks to the Encore.ts backend: responses are Encore-native (no
 * { success, data } / { error } envelope), and the CSRF token is obtained
 * from the GET /api/v1/auth/csrf-token body (Encore does not echo it in a
 * response header), kept in memory, and replayed in the X-CSRF-Token header
 * on state-changing requests (double-submit against the httpOnly csrf cookie).
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

const API_BASE = '/api/v1'

// CSRF token kept in memory; sourced from /auth/csrf-token, replayed on mutations.
let csrfToken: string | null = null
// Deduplicate concurrent /auth/csrf-token fetches (mirrors the fetchUser guard).
let csrfTokenPromise: Promise<void> | null = null

async function ensureCsrfToken(): Promise<void> {
  if (csrfToken) return
  if (csrfTokenPromise) return csrfTokenPromise
  csrfTokenPromise = (async () => {
    try {
      const { data } = await axios.get<{ token: string }>(`${API_BASE}/auth/csrf-token`, {
        withCredentials: true
      })
      csrfToken = data.token
    } catch {
      // Leave null; the mutation will fail closed with a CSRF error we surface.
    } finally {
      csrfTokenPromise = null
    }
  })()
  return csrfTokenPromise
}

// Only follow http(s) redirects from the SLO response; reject javascript:,
// data:, and other script-bearing schemes even though the URL comes from our
// own backend (defence-in-depth against a compromised or buggy response).
function isSafeRedirect(url: string): boolean {
  try {
    const { protocol } = new URL(url, window.location.origin)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

// Replay the CSRF token on state-changing requests. Track the id so it can be
// ejected on HMR re-execution.
const requestInterceptorId = axios.interceptors.request.use((config) => {
  if (csrfToken && config.method && ['post', 'put', 'patch', 'delete'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = csrfToken
  }
  return config
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    axios.interceptors.request.eject(requestInterceptorId)
  })
}

export interface User {
  id: string
  email: string
  name: string
  roles: string[]
  attributes?: Record<string, unknown>
  organization?: string
}

// Encore GET /api/v1/auth/me — bare profile, no envelope.
interface MeResponse {
  id: string
  email: string
  name: string
  roles: string[]
  ssoProvider?: string
  isActive?: boolean
  lastLoginAt?: string | null
  createdAt?: string
}

// Encore GET /api/v1/auth/status — bare, no envelope.
interface StatusResponse {
  authenticated: boolean
  drivers?: string[]
}

// Encore error envelope: { code, message, details? }.
type AxiosErrorLike = {
  response?: { status?: number; data?: { message?: string; code?: string; details?: { code?: string } } }
}

export const useAuthStore = defineStore('auth', () => {
  // State
  const user = ref<User | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const sessionExpired = ref(false)
  const loggingOut = ref(false)

  // Getters
  const isAuthenticated = computed(() => !!user.value)
  const hasRole = computed(() => (role: string | string[]) => {
    if (!user.value || !user.value.roles) return false
    const requiredRoles = Array.isArray(role) ? role : [role]
    return requiredRoles.some(r => (user.value as User).roles.includes(r))
  })

  // Deduplicate in-flight fetchUser calls so router guard and App.vue don't race
  let fetchPromise: Promise<User | null> | null = null

  // Actions
  async function fetchUser() {
    // If a fetch is already in-flight, return the same promise
    if (fetchPromise) return fetchPromise

    fetchPromise = (async () => {
      try {
        loading.value = true
        error.value = null

        const response = await axios.get<MeResponse>(`${API_BASE}/auth/me`, {
          withCredentials: true
        })

        const me = response.data
        user.value = { id: me.id, email: me.email, name: me.name, roles: me.roles ?? [] }
        return user.value
      } catch (err: unknown) {
        const axiosErr = err as AxiosErrorLike
        if (axiosErr.response?.status === 401) {
          // If the user was previously authenticated, this is a session expiry
          if (user.value !== null) {
            sessionExpired.value = true
          }
          user.value = null
        } else {
          error.value = axiosErr.response?.data?.message ?? 'Failed to fetch user'
          console.error('Failed to fetch user:', err)
        }
        return null
      } finally {
        loading.value = false
        fetchPromise = null
      }
    })()

    return fetchPromise
  }

  function login(driver: string, options?: { userIndex?: number }) {
    try {
      loading.value = true
      error.value = null

      // Redirect to per-driver login endpoint
      const params = options?.userIndex !== undefined ? `?user=${options.userIndex}` : ''
      window.location.href = `${API_BASE}/auth/${driver}/login${params}`
    } catch (err: unknown) {
      const axiosErr = err as AxiosErrorLike
      error.value = axiosErr.response?.data?.message ?? 'Failed to login'
      loading.value = false
      throw err
    }
  }

  function clearLoggingOut() {
    loggingOut.value = false
  }

  async function logout() {
    loggingOut.value = true
    try {
      loading.value = true
      error.value = null

      // Encore CSRF-protects logout; ensure we hold a token to replay.
      await ensureCsrfToken()

      const response = await axios.post(`${API_BASE}/auth/logout`, {}, {
        withCredentials: true
      })

      user.value = null

      // If the server returned a SLO redirect URL (OIDC end-session), navigate to it
      // so the IdP session is also terminated. Only follow safe http(s) URLs.
      const redirectUrl = (response.data as { redirectUrl?: string })?.redirectUrl
      if (redirectUrl && isSafeRedirect(redirectUrl)) {
        window.location.href = redirectUrl
        return
      }
    } catch (err: unknown) {
      const axiosErr = err as AxiosErrorLike
      error.value = axiosErr.response?.data?.message ?? 'Failed to logout'
      throw err
    } finally {
      loading.value = false
      // Drop the cached CSRF token: the server invalidates the csrf cookie on
      // logout, so a stale in-memory token must not be replayed on the next
      // post-login mutation. (Also keeps module state from leaking between
      // unit tests.)
      csrfToken = null
    }
  }

  async function checkStatus() {
    try {
      const response = await axios.get<StatusResponse>(`${API_BASE}/auth/status`, {
        withCredentials: true
      })

      return response.data
    } catch {
      return { authenticated: false, drivers: [] as string[] }
    }
  }

  return {
    // State
    user,
    loading,
    error,
    sessionExpired,
    loggingOut,

    // Getters
    isAuthenticated,
    hasRole,

    // Actions
    fetchUser,
    login,
    logout,
    clearLoggingOut,
    checkStatus
  }
})

import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.store'
import { getRouterPlugins } from './registry'
import { registerAllWebModules } from '../modules'

// Register modules (nav items, dynamic routes) before router is created
registerAllWebModules()

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('../views/DashboardView.vue'),
      meta: {
        title: 'Dashboard - Internal Portal',
        requiresAuth: true,
      },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: {
        title: 'Sign In - Internal Portal',
        guestOnly: true,
      },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('../views/ProfileView.vue'),
      meta: {
        title: 'My Profile - Internal Portal',
        requiresAuth: true,
      },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
      meta: { title: 'Page Not Found - Internal Portal' },
    },
  ],
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  },
})

// Add dynamic routes registered by installed modules
for (const plugin of getRouterPlugins()) {
  for (const route of plugin.routes ?? []) {
    router.addRoute(route)
  }
}

// Navigation guard — internal app defaults to requiring auth
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore()

  // Skip fetchUser during a deliberate logout — the session is already being
  // destroyed server-side and re-fetching would race against that destruction,
  // potentially re-authenticating the user before /login is reached.
  if (!authStore.user && !authStore.loggingOut) {
    await authStore.fetchUser()
  }

  // All routes require auth unless explicitly marked guestOnly
  const requiresAuth = to.meta.requiresAuth !== false && !to.meta.guestOnly
  if (requiresAuth && !authStore.isAuthenticated) {
    next({
      name: 'login',
      query: { redirect: to.fullPath },
    })
    return
  }

  if (to.meta.guestOnly && authStore.isAuthenticated) {
    next({ name: 'dashboard' })
    return
  }

  next()
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  if (title) {
    document.title = title
  }

  // Clear the loggingOut flag once navigation has settled so the guard
  // resumes normal fetchUser behaviour on subsequent navigations.
  const authStore = useAuthStore()
  authStore.clearLoggingOut()
})

export default router

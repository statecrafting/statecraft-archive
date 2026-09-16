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
      name: 'home',
      component: () => import('../views/HomeView.vue'),
      meta: { title: 'Home - Application Template' }
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('../views/AboutView.vue'),
      meta: { title: 'About - Application Template' }
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: {
        title: 'Sign In - Application Template',
        guestOnly: true
      }
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('../views/ProfileView.vue'),
      meta: {
        title: 'My Profile - Application Template',
        requiresAuth: true
      }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
      meta: { title: 'Page Not Found - Application Template' }
    }
  ],
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  }
})

// Add dynamic routes registered by installed modules
for (const plugin of getRouterPlugins()) {
  for (const route of plugin.routes ?? []) {
    router.addRoute(route)
  }
}

// Navigation guard for authentication
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore()

  if (!authStore.user) {
    await authStore.fetchUser()
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({
      name: 'login',
      query: { redirect: to.fullPath }
    })
    return
  }

  if (to.meta.guestOnly && authStore.isAuthenticated) {
    next({ name: 'profile' })
    return
  }

  next()
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  if (title) {
    document.title = title
  }
})

export default router

import { registerRouterPlugin } from './router/registry'
import { registerNavItem } from './composables/useNavigation'

registerRouterPlugin({
  name: 'user-management',
  routes: [
    {
      path: '/admin/users',
      name: 'admin-users',
      component: () => import('./views/admin/UserListView.vue'),
      meta: { title: 'User Management', requiresAuth: true },
    },
    {
      path: '/admin/users/:id',
      name: 'admin-user-detail',
      component: () => import('./views/admin/UserDetailView.vue'),
      meta: { title: 'User Detail', requiresAuth: true },
    },
  ],
})

registerNavItem({
  id: 'nav-admin-users',
  label: 'Users',
  to: '/admin/users',
  slot: 'primary',
  icon: 'people',
  priority: 50,
})

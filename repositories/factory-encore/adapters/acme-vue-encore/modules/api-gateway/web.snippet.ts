import { registerRouterPlugin } from './router/registry'
import { registerNavItem } from './composables/useNavigation'

registerRouterPlugin({
  name: 'api-gateway',
  routes: [
    {
      path: '/connectivity',
      name: 'connectivity',
      component: () => import('./views/ConnectivityTestView.vue'),
      meta: { title: 'Connectivity Test - Application Template', requiresAuth: true },
    },
  ],
})

registerNavItem({
  id: 'nav-connectivity',
  label: 'Connectivity',
  to: '/connectivity',
  position: 'left',
  priority: 30,
})

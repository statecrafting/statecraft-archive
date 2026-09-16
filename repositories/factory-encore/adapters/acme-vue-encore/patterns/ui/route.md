# Pattern: route

Each page is registered as a lazy-loaded route in the SPA router. Auth
requirements are expressed as route meta and enforced by a navigation guard.

## Conventions

- Lazy-load the view component so each page is its own chunk.
- `meta.requiresAuth` and `meta.requiredRoles` carry the page's auth needs from
  the Build Spec. A `guestOnly` flag marks pages like login that authenticated
  users should skip.
- The guard checks the auth store; it redirects unauthenticated users to login
  and rejects users who lack the required role.

## Example

`apps/web/src/router/index.ts`:

```ts
import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth.store";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: () => import("@/views/HomeView.vue") },
    { path: "/events", name: "events", component: () => import("@/views/EventsView.vue") },
    {
      path: "/my/registrations",
      name: "my-registrations",
      component: () => import("@/views/MyRegistrationsView.vue"),
      meta: { requiresAuth: true, requiredRoles: ["attendee"] },
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.authenticated) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
});

export default router;
```

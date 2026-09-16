import type { RouteRecordRaw, NavigationGuardWithThis, RouteLocationNormalized } from 'vue-router'

export interface RouterPlugin {
  name: string
  routes?: RouteRecordRaw[]
  beforeEach?: NavigationGuardWithThis<undefined>
  afterEach?: (to: RouteLocationNormalized, from: RouteLocationNormalized) => void
  protectedRoutes?: string[]
}

const plugins: RouterPlugin[] = []

export function registerRouterPlugin(plugin: RouterPlugin): void {
  plugins.push(plugin)
}

export function getRouterPlugins(): RouterPlugin[] {
  return [...plugins]
}

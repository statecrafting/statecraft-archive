import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'

function wrapPem(base64: string, label: string): string {
  if (base64.includes('-----BEGIN')) return base64
  const lines = base64.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (not just VITE_) from project root .env
  const env = loadEnv(mode, path.resolve(__dirname, '..', '..'), '')

  const hasTls = !!(env.DEV_TLS_KEY && env.DEV_TLS_CERT)
  const httpsConfig = hasTls
    ? { key: wrapPem(env.DEV_TLS_KEY, 'PRIVATE KEY'), cert: wrapPem(env.DEV_TLS_CERT, 'CERTIFICATE') }
    : undefined
  const apiProtocol = hasTls ? 'https' : 'http'

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: true,
      allowedHosts: true,
      port: 5174,
      https: httpsConfig,
      proxy: {
        '/api': {
          target: env.API_URL || `${apiProtocol}://localhost:4000`,
          changeOrigin: true,
          secure: false, // Accept self-signed TLS certs from local API
        },
      },
    },
  }
})

<template>
  <div class="wide-content connectivity-view">
    <h1 class="page-title">
      Connectivity Test
    </h1>

    <Message
      v-if="!user"
      severity="warn"
      :closable="false"
    >
      <strong>Not authenticated</strong>
      <p>
        You must be <router-link to="/login">
          signed in
        </router-link> to test backend connectivity.
      </p>
    </Message>

    <template v-else>
      <p class="description">
        Tests end-to-end connectivity from this application through the BFF gateway to the private backend API.
      </p>

      <!-- Live region for screen reader announcements -->
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        class="visually-hidden"
      >
        <span v-if="loading">Testing backend connectivity, please wait.</span>
        <span v-else-if="error">Connection check failed. See error details on screen.</span>
        <span v-else-if="result">Successfully connected to the backend.</span>
      </div>

      <Card
        class="section-card"
        :aria-busy="loading ? 'true' : 'false'"
      >
        <template #content>
          <div class="section-header">
            <h2 class="section-title">
              Private Backend (/info)
            </h2>
            <Button
              severity="secondary"
              :disabled="loading"
              :label="loading ? 'Testing...' : 'Test Again'"
              @click="runTest"
            />
          </div>

          <template v-if="loading">
            <Message
              severity="info"
              :closable="false"
            >
              <strong>Testing...</strong>
              <p>Checking the connection to the private backend. This may take a moment.</p>
            </Message>
          </template>

          <template v-else-if="error">
            <Message
              severity="error"
              :closable="false"
            >
              <strong>Connection failed</strong>
              <p>{{ error }}</p>
            </Message>

            <div class="troubleshoot">
              <h3 class="section-title">
                What to check
              </h3>
              <ul class="troubleshoot-list">
                <li>Make sure <code>PRIVATE_API_BASE_URL</code> is set in your <code>.env</code> file</li>
                <li>Make sure <code>OAUTH_*</code> credentials are filled in</li>
                <li>Confirm the private backend service is running and reachable</li>
                <li>Check the API server logs for more details</li>
              </ul>
            </div>
          </template>

          <template v-else-if="result">
            <Message
              severity="success"
              :closable="false"
            >
              <strong>Connected</strong>
              <p>Successfully reached the private backend through the BFF gateway.</p>
            </Message>

            <dl class="info-list">
              <div class="info-row">
                <dt>Status</dt>
                <dd>
                  <Tag
                    severity="success"
                    value="Connected"
                  />
                </dd>
              </div>

              <div class="info-row">
                <dt>Response Time</dt>
                <dd class="mono">
                  {{ responseTime }}ms
                </dd>
              </div>

              <div
                v-for="(value, key) in result"
                :key="key"
                class="info-row"
              >
                <dt>{{ key }}</dt>
                <dd class="mono">
                  {{ typeof value === 'object' ? JSON.stringify(value) : value }}
                </dd>
              </div>
            </dl>
          </template>

          <template v-else>
            <p>Click <strong>Test Again</strong> or wait for the automatic test to complete.</p>
          </template>
        </template>
      </Card>

      <Card class="section-card">
        <template #content>
          <h2 class="section-title">
            Request Path
          </h2>
          <dl class="info-list">
            <div class="info-row">
              <dt>Frontend</dt>
              <dd class="mono">
                GET /api/v1/data/info
              </dd>
            </div>
            <div class="info-row">
              <dt>BFF Gateway</dt>
              <dd class="mono">
                requireAuth + OAuth token injection
              </dd>
            </div>
            <div class="info-row">
              <dt>Private Backend</dt>
              <dd class="mono">
                GET {PRIVATE_API_BASE_URL}/info
              </dd>
            </div>
          </dl>
        </template>
      </Card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import { useAuthStore } from '../stores/auth.store'
import axios from 'axios'

const API_BASE = '/api/v1'

const authStore = useAuthStore()
const user = computed(() => authStore.user)

const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<Record<string, unknown> | null>(null)
const responseTime = ref<number>(0)

async function runTest() {
  loading.value = true
  error.value = null
  result.value = null

  const start = performance.now()

  try {
    const response = await axios.get<Record<string, unknown>>(`${API_BASE}/data/info`, {
      withCredentials: true,
    })

    responseTime.value = Math.round(performance.now() - start)

    // The BFF gateway is a transparent passthrough: a 2xx means the private
    // backend was reached. Encore returns the bare backend payload (no
    // { success, data } envelope), so display the response body directly.
    result.value = response.data ?? null
  } catch (err: unknown) {
    responseTime.value = Math.round(performance.now() - start)

    const axiosErr = err as { response?: { status?: number; data?: { message?: string } }; message?: string }
    if (axiosErr.response?.status === 401) {
      error.value = 'Your session has expired. Please sign in again to continue.'
    } else if (axiosErr.response?.status === 503) {
      error.value = 'The gateway is not set up correctly. Check your environment configuration.'
    } else if (axiosErr.response?.status === 502) {
      error.value = 'Could not reach the private backend. Make sure the service is running.'
    } else if (axiosErr.response?.status === 504) {
      error.value = 'The backend took too long to respond. The service may be busy or unavailable.'
    } else {
      error.value = axiosErr.response?.data?.message || 'Something went wrong. Please try again.'
    }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!user.value) {
    await authStore.fetchUser()
  }
  if (user.value) {
    await runTest()
  }
})
</script>

<style scoped>
.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 0 0 1.5rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--p-primary-color);
}

.description {
  color: var(--app-text-muted);
  margin: 0 0 1.5rem;
}

.section-card {
  margin-bottom: 1.5rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.section-header .section-title {
  margin: 0;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 1.5rem 0;
}

.troubleshoot {
  margin-top: 1rem;
}

.info-list {
  margin: 0;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 0;
  border-bottom: 1px solid var(--p-surface-200);
}

.info-row:last-child {
  border-bottom: none;
}

.info-row dt {
  font-weight: 600;
  color: var(--app-text-muted);
}

.info-row dd {
  margin: 0;
}

.info-row dd.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.95rem;
  word-break: break-all;
  max-width: 60%;
  text-align: right;
}

.troubleshoot-list {
  margin: 0.5rem 0 0 0;
  padding-left: 1.5rem;
}

.troubleshoot-list li {
  margin-bottom: 0.25rem;
}

.troubleshoot-list code {
  background: var(--p-surface-100);
  padding: 0.125rem 0.25rem;
  border-radius: 4px;
  font-size: 0.85rem;
}
</style>

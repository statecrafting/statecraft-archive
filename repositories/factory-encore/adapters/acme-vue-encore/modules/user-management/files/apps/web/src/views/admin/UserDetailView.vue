<template>
  <div class="user-detail-view">
    <div class="page-topbar">
      <h1>User Detail</h1>
      <Button
        label="Back to Users"
        severity="secondary"
        text
        size="small"
        @click="goBack"
      />
    </div>

    <div class="page-body">
      <!-- Loading -->
      <div
        v-if="loading"
        class="loading-state"
      >
        <ProgressSpinner style="width: 2rem; height: 2rem" />
      </div>

      <!-- Error -->
      <Message
        v-else-if="error"
        severity="error"
        :closable="false"
        class="state-message"
      >
        <strong>Error</strong>
        <p>{{ error }}</p>
      </Message>

      <!-- Not found -->
      <Message
        v-else-if="!user"
        severity="warn"
        :closable="false"
        class="state-message"
      >
        <strong>User Not Found</strong>
        <p>The requested user could not be found.</p>
      </Message>

      <!-- User detail -->
      <template v-else>
        <!-- User info -->
        <Card class="section-card">
          <template #content>
            <h2 class="section-title">
              Profile Information
            </h2>
            <dl class="info-list">
              <div class="info-row">
                <dt>Name</dt>
                <dd>{{ user.name }}</dd>
              </div>
              <div class="info-row">
                <dt>Email</dt>
                <dd>{{ user.email }}</dd>
              </div>
              <div class="info-row">
                <dt>Created</dt>
                <dd>{{ formatDate(user.createdAt) }}</dd>
              </div>
              <div class="info-row">
                <dt>Last Login</dt>
                <dd>{{ formatDate(user.lastLoginAt) }}</dd>
              </div>
              <div class="info-row">
                <dt>IdP Roles</dt>
                <dd>
                  <span
                    v-if="!user.idpRoles.length"
                    class="no-roles"
                  >None</span>
                  <Tag
                    v-for="role in user.idpRoles"
                    :key="role"
                    severity="secondary"
                    :value="role"
                  />
                </dd>
              </div>
              <div class="info-row">
                <dt>Status</dt>
                <dd>
                  <Tag
                    :severity="user.isActive ? 'success' : 'danger'"
                    :value="user.isActive ? 'Active' : 'Inactive'"
                  />
                </dd>
              </div>
            </dl>

            <div class="section-actions">
              <Button
                :label="user.isActive ? 'Deactivate User' : 'Activate User'"
                :severity="user.isActive ? 'secondary' : 'primary'"
                size="small"
                @click="toggleActive"
              />
            </div>
          </template>
        </Card>

        <!-- Role assignment -->
        <Card class="section-card">
          <template #content>
            <h2 class="section-title">
              Role Assignment
            </h2>
            <p class="section-description">
              Select the roles to assign to this user. Changes take effect on their next login.
            </p>

            <div class="role-list">
              <div
                v-for="role in allRoles"
                :key="role.id"
                class="role-item"
              >
                <Checkbox
                  :inputId="'role-' + role.id"
                  :binary="true"
                  :modelValue="selectedRoleIds.has(role.id)"
                  @update:modelValue="(checked: boolean) => toggleRole(role.id, checked)"
                />
                <label
                  :for="'role-' + role.id"
                  class="role-label"
                >{{ role.name }}</label>
                <span
                  v-if="role.description"
                  class="role-description"
                >
                  {{ role.description }}
                </span>
                <Tag
                  v-if="role.isSystem"
                  severity="secondary"
                  value="System"
                />
              </div>
            </div>

            <div class="actions">
              <Button
                label="Save Roles"
                :disabled="!rolesChanged || saving"
                size="small"
                @click="saveRoles"
              />
              <Button
                v-if="rolesChanged"
                label="Reset"
                severity="secondary"
                text
                size="small"
                @click="resetRoles"
              />
            </div>
          </template>
        </Card>

        <!-- Save confirmation -->
        <Message
          v-if="saveSuccess"
          severity="success"
          :closable="false"
          class="state-message"
        >
          <strong>Roles Updated</strong>
          <p>Role assignments have been saved. Changes take effect on the user's next login.</p>
        </Message>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import ProgressSpinner from 'primevue/progressspinner'
import Message from 'primevue/message'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'

// Mirrors the backend AppRole (user-management/types.ts).
interface Role {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  createdAt: string
}

// Mirrors the backend UserSummary: bare, camelCase payload. appRoles/idpRoles
// are role-name lists (app-assigned vs IdP-sourced), not nested objects.
interface User {
  id: string
  email: string
  name: string
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  appRoles: string[]
  idpRoles: string[]
}

const route = useRoute()
const router = useRouter()

const user = ref<User | null>(null)
const allRoles = ref<Role[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const saving = ref(false)
const saveSuccess = ref(false)

// Track selected role IDs (reactive set)
const selectedRoleIds = ref<Set<string>>(new Set())
const originalRoleIds = ref<Set<string>>(new Set())

const rolesChanged = computed(() => {
  if (selectedRoleIds.value.size !== originalRoleIds.value.size) return true
  for (const id of selectedRoleIds.value) {
    if (!originalRoleIds.value.has(id)) return true
  }
  return false
})

async function fetchData() {
  loading.value = true
  error.value = null
  try {
    const [userRes, rolesRes] = await Promise.all([
      axios.get<{ user: User }>(`/api/v1/admin/users/${String(route.params.id)}`),
      axios.get<{ roles: Role[] }>('/api/v1/admin/roles'),
    ])
    // Encore returns bare payloads ({ user } / { roles }); no { data } envelope.
    user.value = userRes.data.user
    allRoles.value = rolesRes.data.roles

    // The user's app roles arrive as role names; map them to ids through the
    // catalog so the checklist (keyed by role id) reflects the current grant.
    const assignedNames = new Set(user.value.appRoles)
    const assignedIds = allRoles.value.filter((r) => assignedNames.has(r.name)).map((r) => r.id)
    selectedRoleIds.value = new Set(assignedIds)
    originalRoleIds.value = new Set(assignedIds)
  } catch {
    error.value = 'Failed to load user data.'
  } finally {
    loading.value = false
  }
}

function toggleRole(roleId: string, checked: boolean) {
  const newSet = new Set(selectedRoleIds.value)
  if (checked) {
    newSet.add(roleId)
  } else {
    newSet.delete(roleId)
  }
  selectedRoleIds.value = newSet
}

function resetRoles() {
  selectedRoleIds.value = new Set(originalRoleIds.value)
  saveSuccess.value = false
}

async function saveRoles() {
  if (!user.value) return
  saving.value = true
  saveSuccess.value = false
  try {
    await axios.put(`/api/v1/admin/users/${user.value.id}/roles`, {
      roleIds: [...selectedRoleIds.value],
    })
    originalRoleIds.value = new Set(selectedRoleIds.value)
    saveSuccess.value = true
  } catch {
    error.value = 'Failed to save roles.'
  } finally {
    saving.value = false
  }
}

async function toggleActive() {
  if (!user.value) return
  try {
    const res = await axios.patch<{ user: User }>(`/api/v1/admin/users/${user.value.id}`, {
      isActive: !user.value.isActive,
    })
    user.value = { ...user.value, ...res.data.user }
  } catch {
    error.value = 'Failed to update user status.'
  }
}

function goBack() {
  void router.push({ name: 'admin-users' })
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(fetchData)
</script>

<style scoped>
.page-body {
  margin-top: 1.5rem;
}

.loading-state {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}

.state-message {
  margin-top: 1rem;
}

.section-card {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
}

.section-description {
  color: var(--app-text-muted);
  font-size: 0.9375rem;
  margin: 0 0 1.5rem;
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

.section-actions {
  margin-top: 1.5rem;
}

.role-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.role-item {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.role-label {
  font-weight: 500;
  cursor: pointer;
}

.role-description {
  font-size: 0.875rem;
  color: var(--app-text-muted);
}

.no-roles {
  color: var(--app-text-muted);
  font-size: 0.875rem;
  font-style: italic;
}

.actions {
  display: flex;
  gap: 1rem;
}
</style>

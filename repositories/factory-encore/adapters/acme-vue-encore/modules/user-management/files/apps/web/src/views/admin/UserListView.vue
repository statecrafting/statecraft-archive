<template>
  <div class="user-list-view">
    <div class="page-topbar">
      <h1>User Management</h1>
      <p>Manage application users and their role assignments.</p>
    </div>

    <div class="page-body">
      <!-- Search -->
      <div class="search-bar">
        <InputText
          v-model="search"
          placeholder="Search by name or email..."
          type="search"
          style="width: 320px"
          @input="onSearch"
        />
      </div>

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

      <!-- Empty state -->
      <Message
        v-else-if="users.length === 0"
        severity="info"
        :closable="false"
        class="state-message"
      >
        <strong>No Users Found</strong>
        <p>{{ search ? 'No users match your search criteria.' : 'No users have been provisioned yet. Users are created automatically on first login.' }}</p>
      </Message>

      <!-- User table -->
      <template v-else>
        <DataTable
          :value="users"
          class="user-table"
        >
          <Column
            field="name"
            header="Name"
          />
          <Column
            field="email"
            header="Email"
          />
          <Column header="Roles">
            <template #body="{ data }">
              <div class="roles">
                <Tag
                  v-for="role in data.appRoles"
                  :key="role"
                  severity="info"
                  :value="role"
                />
                <span
                  v-if="!data.appRoles?.length"
                  class="no-roles"
                >No roles</span>
              </div>
            </template>
          </Column>
          <Column header="Status">
            <template #body="{ data }">
              <Tag
                :severity="data.isActive ? 'success' : 'danger'"
                :value="data.isActive ? 'Active' : 'Inactive'"
              />
            </template>
          </Column>
          <Column header="Last Login">
            <template #body="{ data }">
              {{ formatDate(data.lastLoginAt) }}
            </template>
          </Column>
          <Column header="">
            <template #body="{ data }">
              <Button
                label="Manage"
                severity="secondary"
                text
                size="small"
                @click="viewUser(data.id)"
              />
            </template>
          </Column>
        </DataTable>

        <!-- Pagination -->
        <div
          v-if="totalPages > 1"
          class="pagination"
        >
          <Button
            label="Previous"
            severity="secondary"
            text
            size="small"
            :disabled="page <= 1"
            @click="goToPage(page - 1)"
          />
          <span class="page-info">Page {{ page }} of {{ totalPages }}</span>
          <Button
            label="Next"
            severity="secondary"
            text
            size="small"
            :disabled="page >= totalPages"
            @click="goToPage(page + 1)"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import InputText from 'primevue/inputtext'
import ProgressSpinner from 'primevue/progressspinner'
import Message from 'primevue/message'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'

// Mirrors the backend UserSummary (user-management/types.ts): bare, camelCase
// payload. appRoles/idpRoles are role-name lists, not nested objects.
interface UserItem {
  id: string
  name: string
  email: string
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  appRoles: string[]
  idpRoles: string[]
}

const router = useRouter()

const users = ref<UserItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const search = ref('')
const page = ref(1)
const totalPages = ref(1)
const limit = 20

async function fetchUsers() {
  loading.value = true
  error.value = null
  try {
    const params: Record<string, string | number> = { page: page.value, limit }
    if (search.value) params.search = search.value

    const res = await axios.get<{ users: UserItem[]; total: number; page: number; limit: number }>(
      '/api/v1/admin/users',
      { params },
    )
    // Encore returns a bare, flat list response ({ users, total, page, limit });
    // there is no { data: { items, pagination } } envelope. Derive page count.
    users.value = res.data.users
    totalPages.value = Math.max(1, Math.ceil(res.data.total / limit))
  } catch {
    error.value = 'Failed to load users. Please try again.'
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  void fetchUsers()
}

function goToPage(p: number) {
  page.value = p
  void fetchUsers()
}

function viewUser(id: string) {
  void router.push({ name: 'admin-user-detail', params: { id } })
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

onMounted(fetchUsers)
</script>

<style scoped>
.page-body {
  margin-top: 1.5rem;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.loading-state {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}

.state-message {
  margin-top: 1rem;
}

.user-table {
  width: 100%;
}

.roles {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.no-roles {
  color: var(--app-text-muted);
  font-size: 0.875rem;
  font-style: italic;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.5rem;
}

.page-info {
  font-size: 0.875rem;
  color: var(--app-text-muted);
}
</style>

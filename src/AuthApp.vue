<script setup>
import { Lock, User, Moon, Sunny } from '@element-plus/icons-vue'
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import App from './App.vue'

const checkingSession = ref(true)
const authenticated = ref(false)
const username = ref('')
const form = ref({
  username: '',
  password: '',
})
const submitting = ref(false)
const isDark = ref(false)

async function checkSession() {
  checkingSession.value = true

  try {
    const response = await fetch('/api/auth/session')
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      authenticated.value = false
      username.value = ''
      return
    }

    authenticated.value = Boolean(payload?.authenticated)
    username.value = String(payload?.username || '')
  } catch {
    authenticated.value = false
    username.value = ''
  } finally {
    checkingSession.value = false
  }
}

async function handleLogin() {
  if (!form.value.username.trim() || !form.value.password) {
    ElMessage.warning('请输入账号和密码')
    return
  }

  submitting.value = true

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: form.value.username.trim(),
        password: form.value.password,
      }),
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(payload?.message || '登录失败')
    }

    authenticated.value = true
    username.value = String(payload?.username || form.value.username.trim())
    form.value.password = ''
    ElMessage.success('登录成功')
  } catch (error) {
    ElMessage.error(error.message || '登录失败')
  } finally {
    submitting.value = false
  }
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
    })
  } finally {
    authenticated.value = false
    username.value = ''
    form.value.password = ''
  }
}

function toggleTheme() {
  isDark.value = !isDark.value
  if (isDark.value) {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'dark')
  } else {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', 'light')
  }
}

onMounted(() => {
  checkSession()
  isDark.value = document.documentElement.classList.contains('dark')
})
</script>

<template>
  <div v-if="checkingSession" class="auth-state">
    <div class="auth-spinner"></div>
    <p class="auth-state__text">正在验证登录状态…</p>
  </div>

  <div v-else-if="authenticated" class="auth-app">
    <header class="auth-topbar">
      <div class="auth-topbar__left">
        <div class="auth-topbar__user">
          <span class="auth-topbar__avatar">{{ (username || '?').slice(0, 1).toUpperCase() }}</span>
          <div class="auth-topbar__info">
            <strong class="auth-topbar__name">{{ username }}</strong>
            <span class="auth-topbar__hint">已登录</span>
          </div>
        </div>
      </div>
      
      <div class="auth-topbar__right">
        <el-button 
          class="theme-toggle" 
          circle 
          :icon="isDark ? Sunny : Moon" 
          @click="toggleTheme" 
        />
        <el-divider direction="vertical" />
        <el-button text @click="handleLogout">退出登录</el-button>
      </div>
    </header>
    <App />
  </div>

  <div v-else class="auth-state">
    <div class="auth-card">
      <div class="auth-card__head">
        <h1 class="auth-card__title">登录</h1>
        <p class="auth-card__desc">使用服务端配置的账号与密码进入 Galxe 任务面板</p>
      </div>

      <el-form label-position="top" class="auth-form" @submit.prevent="handleLogin">
        <el-form-item label="账号">
          <el-input v-model="form.username" :prefix-icon="User" autocomplete="username" />
        </el-form-item>

        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            :prefix-icon="Lock"
            show-password
            type="password"
            autocomplete="current-password"
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-button class="auth-form__submit" type="primary" :loading="submitting" @click="handleLogin">
          登录
        </el-button>
      </el-form>

      <div class="auth-card__footer">
        <el-button 
          link 
          class="theme-toggle--footer" 
          :icon="isDark ? Sunny : Moon" 
          @click="toggleTheme"
        >
          切换{{ isDark ? '浅色' : '深色' }}模式
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-state {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
  background-color: var(--bg-body);
}

.auth-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2.5px solid var(--border-color);
  border-top-color: var(--accent-primary);
  animation: spin 0.7s linear infinite;
}

.auth-state__text {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.auth-card {
  width: min(400px, 100%);
  padding: 32px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: var(--shadow-md);
}

.auth-card__head {
  margin-bottom: 24px;
}

.auth-card__title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.auth-card__desc {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.auth-card__footer {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: center;
}

.auth-form__submit {
  width: 100%;
  height: 44px;
  margin-top: 8px;
  border-radius: var(--radius-md);
  font-weight: 600;
  font-size: 15px;
}

.auth-app {
  min-height: 100vh;
}

.auth-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  height: var(--header-height);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
  backdrop-filter: blur(8px);
}

.auth-topbar__left,
.auth-topbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.auth-topbar__user {
  display: flex;
  align-items: center;
  gap: 12px;
}

.auth-topbar__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-muted);
  color: var(--accent-primary);
  font-weight: 700;
  font-size: 14px;
}

.auth-topbar__info {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.auth-topbar__name {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 600;
}

.auth-topbar__hint {
  font-size: 12px;
  color: var(--text-secondary);
}

.theme-toggle {
  border: none;
  background: transparent;
  font-size: 18px;
  color: var(--text-secondary);
}

.theme-toggle:hover {
  color: var(--accent-primary);
  background: var(--bg-muted);
}

.theme-toggle--footer {
  font-size: 13px;
  color: var(--text-secondary);
}

:deep(.auth-form .el-form-item) {
  margin-bottom: 20px;
}

:deep(.auth-form .el-form-item__label) {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 13px;
  padding-bottom: 6px;
}

:deep(.auth-form .el-input__wrapper) {
  min-height: 44px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 600px) {
  .auth-topbar {
    padding: 0 16px;
  }

  .auth-card {
    padding: 32px 24px;
    border: none;
    box-shadow: none;
    background: transparent;
  }
}
</style>


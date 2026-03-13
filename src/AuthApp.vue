<script setup>
import { Lock, User } from '@element-plus/icons-vue'
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

onMounted(() => {
  checkSession()
})
</script>

<template>
  <div v-if="checkingSession" class="auth-shell auth-shell-loading">
    <div class="auth-loading-card">
      <div class="auth-loading-mark"></div>
      <p class="auth-loading-text">正在验证登录状态...</p>
    </div>
  </div>

  <div v-else-if="authenticated" class="auth-app-shell">
    <header class="auth-topbar">
      <div class="auth-topbar-copy">
        <span class="auth-topbar-label">Protected Access</span>
        <strong class="auth-topbar-user">{{ username }}</strong>
      </div>
      <el-button plain @click="handleLogout">退出登录</el-button>
    </header>
    <App />
  </div>

  <div v-else class="auth-shell">
    <div class="auth-panel">
      <section class="auth-hero">
        <span class="auth-kicker">GALXE TASK CONSOLE</span>
        <h1 class="auth-title">登录后才能访问任务面板</h1>
        <p class="auth-subtitle">账号和密码由服务端环境变量控制，浏览器不会拿到原始凭据。</p>
      </section>

      <section class="auth-card">
        <div class="auth-card-head">
          <h2 class="auth-card-title">账号登录</h2>
          <p class="auth-card-desc">输入环境变量中配置的账号密码。</p>
        </div>

        <el-form label-position="top" @submit.prevent="handleLogin">
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

          <el-button class="auth-submit" type="primary" :loading="submitting" @click="handleLogin">
            登录
          </el-button>
        </el-form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.auth-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at top left, rgba(245, 158, 11, 0.2), transparent 34%),
    radial-gradient(circle at bottom right, rgba(14, 165, 233, 0.22), transparent 38%),
    linear-gradient(135deg, #07111f 0%, #111827 42%, #1f2937 100%);
}

.auth-shell-loading {
  background:
    radial-gradient(circle at center, rgba(14, 165, 233, 0.2), transparent 24%),
    linear-gradient(135deg, #07111f 0%, #111827 42%, #1f2937 100%);
}

.auth-panel {
  width: min(1080px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(340px, 420px);
  gap: 24px;
  align-items: stretch;
}

.auth-hero,
.auth-card,
.auth-loading-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 28px;
  backdrop-filter: blur(20px);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}

.auth-hero {
  position: relative;
  overflow: hidden;
  padding: 40px;
  background:
    radial-gradient(circle at 20% 20%, rgba(245, 158, 11, 0.18), transparent 26%),
    linear-gradient(160deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.82));
}

.auth-hero::after {
  content: '';
  position: absolute;
  right: -72px;
  bottom: -72px;
  width: 220px;
  height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.28), transparent 68%);
}

.auth-kicker {
  display: inline-flex;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.14);
  color: #fcd34d;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.auth-title {
  margin: 18px 0 12px;
  color: #f8fafc;
  font-size: clamp(32px, 5vw, 54px);
  line-height: 1.05;
  font-weight: 900;
}

.auth-subtitle {
  max-width: 520px;
  color: rgba(226, 232, 240, 0.8);
  font-size: 16px;
  line-height: 1.7;
}

.auth-card,
.auth-loading-card {
  padding: 28px;
  background: rgba(255, 255, 255, 0.08);
}

.auth-card-head {
  margin-bottom: 18px;
}

.auth-card-title {
  margin: 0;
  color: #f8fafc;
  font-size: 28px;
  font-weight: 900;
}

.auth-card-desc,
.auth-loading-text {
  margin: 8px 0 0;
  color: rgba(226, 232, 240, 0.7);
  line-height: 1.6;
}

.auth-submit {
  width: 100%;
  height: 46px;
  margin-top: 8px;
  border: none;
  background: linear-gradient(135deg, #f59e0b 0%, #f97316 48%, #0ea5e9 100%);
  box-shadow: 0 18px 32px rgba(249, 115, 22, 0.28);
}

.auth-loading-card {
  min-width: min(420px, 100%);
  text-align: center;
}

.auth-loading-mark {
  width: 54px;
  height: 54px;
  margin: 0 auto;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.12);
  border-top-color: #f59e0b;
  animation: spin 0.9s linear infinite;
}

.auth-app-shell {
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
  padding: 14px 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(7, 17, 31, 0.92);
  backdrop-filter: blur(18px);
}

.auth-topbar-copy {
  display: flex;
  align-items: center;
  gap: 10px;
}

.auth-topbar-label {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.14);
  color: #f59e0b;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.auth-topbar-user {
  color: #f8fafc;
  font-size: 14px;
}

:deep(.auth-card .el-form-item__label) {
  color: #e2e8f0;
  font-weight: 700;
}

:deep(.auth-card .el-input__wrapper) {
  min-height: 46px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.88);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
}

:deep(.auth-card .el-input__inner) {
  color: #f8fafc;
}

:deep(.auth-card .el-input__prefix-inner),
:deep(.auth-card .el-input__suffix-inner),
:deep(.auth-card .el-icon) {
  color: #f59e0b;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .auth-panel {
    grid-template-columns: 1fr;
  }

  .auth-hero,
  .auth-card {
    padding: 24px;
  }

  .auth-topbar {
    flex-wrap: wrap;
  }
}
</style>

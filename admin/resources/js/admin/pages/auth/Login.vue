<template>
  <div class="login-page">
    <div class="login-orb login-orb--1"></div>
    <div class="login-orb login-orb--2"></div>
    <div class="login-orb login-orb--3"></div>

    <div class="login-card">
      <div class="brand">
        <div class="brand-mark">橙</div>
        <div>
          <h1>{{ site.name }}</h1>
          <p>{{ site.description }}</p>
        </div>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="submit">
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" size="large" placeholder="请输入管理员账号" prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" size="large" type="password" show-password placeholder="请输入密码" prefix-icon="Lock" />
        </el-form-item>
        <el-button class="login-btn" type="primary" size="large" :loading="loading" @click="submit">
          登录后台
        </el-button>
      </el-form>

      <div class="login-foot">
        <span>橙子英语 · 云端管理后台</span>
        <span class="dot">·</span>
        <span>App API v1</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@admin/stores/user';
import request from '@admin/utils/request';

const router = useRouter();
const route = useRoute();
const store = useUserStore();

const formRef = ref();
const loading = ref(false);
const site = reactive({ name: '橙子英语', description: '英语听读 App 云端管理后台' });

const form = reactive({ username: '', password: '' });
const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

onMounted(async () => {
  try {
    const res = await request.get('/auth/config', { silent_error: true });
    Object.assign(site, res.data || {});
  } catch (e) {
    // 配置读取失败不影响登录
  }
});

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    await store.login({ username: form.username.trim(), password: form.password });
    ElMessage.success('登录成功');
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.replace(target.startsWith('/') ? target : '/');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(135deg, #fff7ed 0%, #ffffff 45%, #fef3c7 100%);
}

.login-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(2px);
  opacity: 0.55;
}

.login-orb--1 {
  width: 420px;
  height: 420px;
  background: radial-gradient(circle at 30% 30%, #fdba74, transparent 70%);
  top: -120px;
  left: -80px;
}

.login-orb--2 {
  width: 360px;
  height: 360px;
  background: radial-gradient(circle at 70% 70%, #fde68a, transparent 70%);
  bottom: -140px;
  right: -60px;
}

.login-orb--3 {
  width: 180px;
  height: 180px;
  background: radial-gradient(circle at 50% 50%, #fb923c, transparent 70%);
  right: 18%;
  top: 12%;
  opacity: 0.25;
}

.login-card {
  position: relative;
  z-index: 1;
  width: 420px;
  max-width: calc(100vw - 40px);
  padding: 34px 34px 26px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(249, 115, 22, 0.15);
  box-shadow: 0 24px 60px rgba(194, 65, 12, 0.14);
  backdrop-filter: blur(10px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 26px;
}

.brand-mark {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: linear-gradient(135deg, #fb923c, #f97316);
  color: #fff;
  font-size: 24px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 22px rgba(249, 115, 22, 0.32);
}

.brand h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 1px;
}

.brand p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.login-btn {
  width: 100%;
  margin-top: 8px;
  font-weight: 600;
  letter-spacing: 2px;
}

.login-foot {
  margin-top: 22px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
}

.dot {
  margin: 0 6px;
}

:deep(.el-form-item__label) {
  font-weight: 600;
}
</style>

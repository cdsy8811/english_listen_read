<template>
  <el-container class="layout">
    <el-aside :width="collapsed ? '72px' : '236px'" class="sidebar">
      <div class="brand" :class="{ 'brand--mini': collapsed }">
        <div class="brand-mark">橙</div>
        <div v-if="!collapsed" class="brand-text">
          <strong>{{ store.siteName }}</strong>
          <span>云端管理后台</span>
        </div>
      </div>

      <el-scrollbar class="menu-scroll">
        <el-menu
          :default-active="activeMenu"
          :collapse="collapsed"
          :collapse-transition="false"
          router
          background-color="transparent"
          text-color="#cbd5e1"
          active-text-color="#ffffff"
          class="side-menu"
        >
          <template v-for="menu in visibleMenus" :key="menu.code || menu.id">
            <el-sub-menu v-if="menu.children?.length" :index="menu.code || String(menu.id)">
              <template #title>
                <el-icon><component :is="menu.icon || 'Menu'" /></el-icon>
                <span>{{ menu.name }}</span>
              </template>
              <el-menu-item
                v-for="child in menu.children"
                :key="child.code || child.id"
                :index="child.path"
              >
                <el-icon v-if="child.icon"><component :is="child.icon" /></el-icon>
                <span>{{ child.name }}</span>
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item v-else-if="menu.path" :index="menu.path">
              <el-icon><component :is="menu.icon || 'Menu'" /></el-icon>
              <template #title>{{ menu.name }}</template>
            </el-menu-item>
          </template>
        </el-menu>
      </el-scrollbar>

      <div v-if="!collapsed" class="sidebar-foot">
        <span>v1.0 · App API v1</span>
      </div>
    </el-aside>

    <el-container class="main-shell">
      <el-header class="topbar">
        <div class="topbar-left">
          <el-button text class="collapse-btn" @click="collapsed = !collapsed">
            <el-icon><Expand v-if="collapsed" /><Fold v-else /></el-icon>
          </el-button>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/' }">工作台</el-breadcrumb-item>
            <el-breadcrumb-item v-if="route.meta.title && route.path !== '/'">
              {{ route.meta.title }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="topbar-right">
          <el-tag v-if="store.user?.username" size="small" effect="plain" class="user-tag">
            {{ store.user.username }}
          </el-tag>
          <el-dropdown trigger="click" @command="handleCommand">
            <div class="user-box">
              <el-avatar :size="30" class="avatar">{{ store.displayName.slice(0, 1) }}</el-avatar>
              <span class="user-name">{{ store.displayName }}</span>
              <el-icon><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="refresh">刷新菜单</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <el-dialog v-model="passwordVisible" title="修改密码" width="460px" :close-on-click-modal="false" destroy-on-close>
      <el-form ref="passwordRef" :model="passwordForm" :rules="passwordRules" label-width="100px">
        <el-form-item label="当前密码" prop="current_password">
          <el-input v-model="passwordForm.current_password" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码" prop="new_password">
          <el-input v-model="passwordForm.new_password" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认新密码" prop="new_password_confirmation">
          <el-input v-model="passwordForm.new_password_confirmation" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordVisible = false">取消</el-button>
        <el-button type="primary" :loading="passwordSaving" @click="submitPassword">保存</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@admin/stores/user';
import request from '@admin/utils/request';

const route = useRoute();
const router = useRouter();
const store = useUserStore();

const collapsed = ref(false);
const passwordVisible = ref(false);
const passwordSaving = ref(false);
const passwordRef = ref();
const passwordForm = reactive({
  current_password: '',
  new_password: '',
  new_password_confirmation: '',
});

const passwordRules = {
  current_password: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  new_password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, max: 64, message: '密码长度 8-64 位', trigger: 'blur' },
  ],
  new_password_confirmation: [
    {
      validator: (rule, value, callback) => {
        if (!value) return callback(new Error('请再次输入新密码'));
        if (value !== passwordForm.new_password) return callback(new Error('两次输入不一致'));
        callback();
      },
      trigger: 'blur',
    },
  ],
};

const visibleMenus = computed(() => {
  const menus = store.menus || [];
  return menus.filter((menu) => menu.path || menu.children?.length);
});

const activeMenu = computed(() => {
  if (route.path.startsWith('/app-users/')) return '/app-users';
  return route.path;
});

function handleCommand(command) {
  if (command === 'password') {
    Object.assign(passwordForm, {
      current_password: '',
      new_password: '',
      new_password_confirmation: '',
    });
    passwordVisible.value = true;
  } else if (command === 'refresh') {
    store.initUser().then(() => ElMessage.success('菜单已刷新'));
  } else if (command === 'logout') {
    store.logout().then(() => router.replace('/login'));
  }
}

async function submitPassword() {
  const valid = await passwordRef.value?.validate().catch(() => false);
  if (!valid) return;

  passwordSaving.value = true;
  try {
    await request.put('/auth/password', { ...passwordForm });
    ElMessage.success('密码修改成功');
    passwordVisible.value = false;
  } finally {
    passwordSaving.value = false;
  }
}
</script>

<style scoped>
.layout {
  height: 100vh;
  background: var(--page-bg);
}

.sidebar {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #111827 0%, #1f2937 100%);
  transition: width 0.2s ease;
  overflow: hidden;
}

.brand {
  height: 64px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.brand--mini {
  justify-content: center;
  padding: 0;
}

.brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: linear-gradient(135deg, #fb923c, #f97316);
  color: #fff;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  color: #fff;
  overflow: hidden;
}

.brand-text strong {
  font-size: 15px;
  white-space: nowrap;
}

.brand-text span {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
  white-space: nowrap;
}

.menu-scroll {
  flex: 1;
  padding: 10px 8px;
}

.side-menu {
  border-right: none;
}

.side-menu :deep(.el-menu-item),
.side-menu :deep(.el-sub-menu__title) {
  height: 42px;
  line-height: 42px;
  border-radius: 10px;
  margin-bottom: 4px;
}

.side-menu :deep(.el-menu-item:hover),
.side-menu :deep(.el-sub-menu__title:hover) {
  background: rgba(249, 115, 22, 0.16) !important;
}

.side-menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(90deg, rgba(249, 115, 22, 0.95), rgba(251, 146, 60, 0.75)) !important;
  font-weight: 600;
}

.sidebar-foot {
  padding: 12px 18px;
  font-size: 11px;
  color: #64748b;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.main-shell {
  min-width: 0;
}

.topbar {
  height: 64px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
}

.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.collapse-btn {
  font-size: 18px;
  color: #4b5563;
}

.user-box {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 10px;
}

.user-box:hover {
  background: var(--brand-soft);
}

.avatar {
  background: linear-gradient(135deg, #fb923c, #f97316);
  color: #fff;
  font-weight: 700;
}

.user-name {
  font-size: 14px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-tag {
  color: var(--brand-dark);
  border-color: #fed7aa;
  background: var(--brand-soft);
}

.content {
  padding: 16px;
  overflow: auto;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .sidebar {
    width: 72px !important;
  }
  .topbar {
    padding: 0 10px;
  }
  .user-name,
  .user-tag {
    display: none;
  }
  .content {
    padding: 10px;
  }
}
</style>

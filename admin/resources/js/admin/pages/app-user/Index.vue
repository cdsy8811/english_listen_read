<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">App 用户</h2>
        <p class="page-desc">多账号数据隔离；每个账号的词库、练习记录、跟读与学习会话独立存储。</p>
      </div>
    </div>

    <BaseCrud ref="crudRef" :config="config">
      <template #actions="{ row }">
        <el-button link type="primary" @click="$router.push(`/app-users/${row.id}`)">详情</el-button>
        <el-button link type="warning" @click="openReset(row)">重置密码</el-button>
      </template>
    </BaseCrud>

    <el-dialog v-model="resetVisible" title="重置 App 用户密码" width="440px" :close-on-click-modal="false" destroy-on-close>
      <el-form ref="resetRef" :model="resetForm" :rules="resetRules" label-width="90px">
        <el-form-item label="账号">
          <el-input :model-value="resetUser?.username" disabled />
        </el-form-item>
        <el-form-item label="新密码" prop="password">
          <el-input v-model="resetForm.password" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="resetSaving" @click="submitReset">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import BaseCrud from '@admin/components/BaseCrud/index.vue';
import request from '@admin/utils/request';

const crudRef = ref();
const resetVisible = ref(false);
const resetSaving = ref(false);
const resetRef = ref();
const resetUser = ref(null);
const resetForm = reactive({ password: '' });

const resetRules = {
  password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, max: 64, message: '密码长度 8-64 位', trigger: 'blur' },
  ],
};

const config = {
  api: '/app-users',
  createTitle: '新增 App 用户',
  editTitle: '编辑 App 用户',
  dialogWidth: '600px',
  actionWidth: 300,
  permissions: {
    add: 'app_user:add',
    edit: 'app_user:edit',
    remove: 'app_user:remove',
  },
  search: [
    { prop: 'keyword', label: '关键词', placeholder: '账号 / 昵称 / UUID', width: '220px' },
    {
      prop: 'status',
      label: '状态',
      type: 'select',
      options: [
        { label: '正常', value: 1 },
        { label: '禁用', value: 0 },
      ],
    },
  ],
  columns: [
    { prop: 'username', label: '账号', minWidth: 120 },
    { prop: 'nickname', label: '昵称', minWidth: 100 },
    {
      prop: 'status',
      label: '状态',
      width: 80,
      type: 'tag',
      dict: { 1: { label: '正常', type: 'success' }, 0: { label: '禁用', type: 'info' } },
    },
    { prop: 'devices_count', label: '设备', width: 70 },
    { prop: 'units_count', label: '单元', width: 70 },
    { prop: 'words_count', label: '词条', width: 70 },
    { prop: 'records_count', label: '练习', width: 70 },
    { prop: 'sessions_count', label: '会话', width: 70 },
    { prop: 'last_login_at', label: '最后登录', minWidth: 150 },
    { prop: 'created_at', label: '注册时间', minWidth: 150 },
  ],
  form: [
    { prop: 'username', label: '账号', required: true, span: 12 },
    { prop: 'nickname', label: '昵称', span: 12 },
    { prop: 'password', label: '密码', type: 'password', span: 12, hint: '新增必填；编辑留空表示不修改' },
    {
      prop: 'status',
      label: '状态',
      type: 'select',
      span: 12,
      options: [
        { label: '正常', value: 1 },
        { label: '禁用', value: 0 },
      ],
      default: 1,
    },
  ],
  rules: {
    username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  },
};

function openReset(row) {
  resetUser.value = row;
  resetForm.password = '';
  resetVisible.value = true;
}

async function submitReset() {
  const valid = await resetRef.value?.validate().catch(() => false);
  if (!valid) return;

  resetSaving.value = true;
  try {
    await request.post(`/app-users/${resetUser.value.id}/reset-password`, { password: resetForm.password });
    ElMessage.success('密码已重置');
    resetVisible.value = false;
  } finally {
    resetSaving.value = false;
  }
}
</script>

<style scoped>
.page-head {
  margin-bottom: 4px;
}
</style>

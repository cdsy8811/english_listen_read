<template>
  <div class="page">
    <h2 class="page-title">管理员</h2>
    <p class="page-desc">后台账号与角色绑定；超级管理员 admin 不可删除或禁用。</p>

    <BaseCrud ref="crudRef" :config="config">
      <template #actions="{ row }">
        <el-button link type="warning" @click="openReset(row)">重置密码</el-button>
      </template>
    </BaseCrud>

    <el-dialog v-model="resetVisible" title="重置管理员密码" width="440px" :close-on-click-modal="false" destroy-on-close>
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
import { onMounted, reactive, ref } from 'vue';
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

const config = reactive({
  api: '/system/users',
  createTitle: '新增管理员',
  editTitle: '编辑管理员',
  dialogWidth: '700px',
  actionWidth: 230,
  permissions: {
    add: 'system:user:add',
    edit: 'system:user:edit',
    remove: 'system:user:remove',
  },
  search: [{ prop: 'keyword', label: '关键词', placeholder: '账号 / 昵称', width: '220px' }],
  columns: [
    { prop: 'username', label: '账号', minWidth: 120 },
    { prop: 'nickname', label: '昵称', minWidth: 110 },
    {
      prop: 'roles',
      label: '角色',
      minWidth: 150,
      formatter: (row) => (row.roles || []).map((role) => role.name).join('，') || '-',
    },
    {
      prop: 'status',
      label: '状态',
      width: 80,
      type: 'tag',
      dict: { 1: { label: '正常', type: 'success' }, 0: { label: '禁用', type: 'info' } },
    },
    { prop: 'last_login_at', label: '最后登录', minWidth: 150 },
    { prop: 'created_at', label: '创建时间', minWidth: 150 },
  ],
  form: [
    { prop: 'username', label: '账号', span: 12 },
    { prop: 'password', label: '密码', type: 'password', span: 12, hint: '新增必填；编辑留空表示不修改' },
    { prop: 'nickname', label: '昵称', span: 12 },
    { prop: 'email', label: '邮箱', span: 12 },
    {
      prop: 'role_ids',
      label: '角色',
      type: 'select',
      multiple: true,
      span: 24,
      options: [],
    },
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
});

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
    await request.post(`/system/users/${resetUser.value.id}/reset-password`, { password: resetForm.password });
    ElMessage.success('密码已重置');
    resetVisible.value = false;
  } finally {
    resetSaving.value = false;
  }
}

async function loadRoles() {
  const res = await request.get('/options/roles');
  config.form.find((item) => item.prop === 'role_ids').options = (res.data || []).map((role) => ({
    label: `${role.name}（${role.code}）`,
    value: role.id,
  }));
}

onMounted(loadRoles);
</script>

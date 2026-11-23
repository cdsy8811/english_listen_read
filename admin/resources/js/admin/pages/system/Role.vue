<template>
  <div class="page">
    <h2 class="page-title">角色</h2>
    <p class="page-desc">角色决定后台菜单与按钮权限；超级管理员角色不可删除。</p>

    <BaseCrud ref="crudRef" :config="config">
      <template #actions="{ row }">
        <el-button link type="primary" @click="openPermissions(row)">权限</el-button>
      </template>
    </BaseCrud>

    <el-dialog v-model="permissionVisible" :title="`权限 · ${currentRole?.name || ''}`" width="620px" destroy-on-close>
      <div class="tree-wrap">
        <el-tree
          ref="treeRef"
          :data="treeData"
          node-key="id"
          show-checkbox
          default-expand-all
          :props="{ label: 'name', children: 'children' }"
        />
      </div>
      <template #footer>
        <el-button @click="permissionVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="savePermissions">保存权限</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import BaseCrud from '@admin/components/BaseCrud/index.vue';
import request from '@admin/utils/request';

const crudRef = ref();
const permissionVisible = ref(false);
const currentRole = ref(null);
const treeData = ref([]);
const treeRef = ref();
const saving = ref(false);

const config = reactive({
  api: '/system/roles',
  createTitle: '新增角色',
  editTitle: '编辑角色',
  dialogWidth: '600px',
  permissions: {
    add: 'system:role:edit',
    edit: 'system:role:edit',
    remove: 'system:role:edit',
  },
  search: [{ prop: 'keyword', label: '关键词', placeholder: '名称 / 编码', width: '220px' }],
  columns: [
    { prop: 'name', label: '角色名', minWidth: 130 },
    { prop: 'code', label: '编码', minWidth: 140 },
    { prop: 'description', label: '说明', minWidth: 180 },
    { prop: 'permissions_count', label: '权限数', width: 90 },
    { prop: 'users_count', label: '管理员数', width: 90 },
    {
      prop: 'status',
      label: '状态',
      width: 80,
      type: 'tag',
      dict: { 1: { label: '启用', type: 'success' }, 0: { label: '停用', type: 'info' } },
    },
  ],
  form: [
    { prop: 'name', label: '角色名', span: 12 },
    { prop: 'code', label: '编码', span: 12, hint: '小写下划线，如 operator' },
    { prop: 'description', label: '说明', span: 24 },
    {
      prop: 'status',
      label: '状态',
      type: 'select',
      span: 12,
      options: [
        { label: '启用', value: 1 },
        { label: '停用', value: 0 },
      ],
      default: 1,
    },
  ],
  rules: {
    name: [{ required: true, message: '请输入角色名', trigger: 'blur' }],
    code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  },
});

async function loadTree() {
  const res = await request.get('/system/permissions');
  treeData.value = res.data || [];
}

async function openPermissions(role) {
  currentRole.value = role;
  permissionVisible.value = true;
  if (!treeData.value.length) await loadTree();
  await nextTick();
  treeRef.value?.setCheckedKeys(role.permission_ids || []);
}

async function savePermissions() {
  if (!currentRole.value || !treeRef.value) return;

  const ids = [...treeRef.value.getCheckedKeys(), ...treeRef.value.getHalfCheckedKeys()];
  saving.value = true;
  try {
    await request.post(`/system/roles/${currentRole.value.id}/permissions`, { permission_ids: ids });
    ElMessage.success('权限已保存');
    permissionVisible.value = false;
    crudRef.value?.refresh();
  } finally {
    saving.value = false;
  }
}

onMounted(loadTree);
</script>

<style scoped>
.tree-wrap {
  max-height: 60vh;
  overflow: auto;
  padding: 8px 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
</style>

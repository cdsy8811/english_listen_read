<template>
  <div class="page">
    <div class="head">
      <div>
        <h2 class="page-title">权限菜单</h2>
        <p class="page-desc">菜单决定左侧导航，按钮权限决定操作是否可见；编码需唯一。</p>
      </div>
      <el-button type="primary" icon="Plus" @click="openCreate(0)">新增顶级菜单</el-button>
    </div>

    <div class="page-card">
      <el-table :data="tree" row-key="id" :tree-props="{ children: 'children' }" default-expand-all border stripe>
        <el-table-column prop="name" label="名称" min-width="180" />
        <el-table-column prop="code" label="编码" min-width="180" />
        <el-table-column prop="type" label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'menu' ? 'warning' : 'info'" effect="plain">
              {{ row.type === 'menu' ? '菜单' : '按钮' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="path" label="路径" min-width="140" />
        <el-table-column prop="component_path" label="组件" min-width="140" />
        <el-table-column prop="sort" label="排序" width="80" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 1 ? 'success' : 'info'" effect="plain">
              {{ row.status === 1 ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openCreate(row.id)">加子项</el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑权限' : '新增权限'" width="680px" :close-on-click-modal="false" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-row :gutter="18">
          <el-col :span="12">
            <el-form-item label="上级" prop="parent_id">
              <el-select v-model="form.parent_id" style="width: 100%">
                <el-option label="顶级" :value="0" />
                <el-option
                  v-for="item in parentOptions"
                  :key="item.id"
                  :label="`${item.type === 'menu' ? '菜单' : '按钮'} · ${item.name}`"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="类型" prop="type">
              <el-select v-model="form.type" style="width: 100%">
                <el-option label="菜单" value="menu" />
                <el-option label="按钮" value="action" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="名称" prop="name">
              <el-input v-model="form.name" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="编码" prop="code">
              <el-input v-model="form.code" placeholder="如 app_user:add" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="路径" prop="path">
              <el-input v-model="form.path" placeholder="/app-users" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="图标" prop="icon">
              <el-input v-model="form.icon" placeholder="Element Plus 图标名" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="组件路径" prop="component_path">
              <el-input v-model="form.component_path" placeholder="app-user/Index" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="排序" prop="sort">
              <el-input-number v-model="form.sort" :min="0" :max="9999" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态" prop="status">
              <el-select v-model="form.status" style="width: 100%">
                <el-option label="启用" :value="1" />
                <el-option label="停用" :value="0" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '@admin/utils/request';

const tree = ref([]);
const flat = ref([]);
const dialogVisible = ref(false);
const editing = ref(null);
const saving = ref(false);
const formRef = ref();

const form = reactive({
  parent_id: 0,
  name: '',
  code: '',
  type: 'menu',
  path: '',
  icon: '',
  component_path: '',
  sort: 0,
  status: 1,
});

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
};

const parentOptions = computed(() =>
  flat.value.filter((item) => !editing.value || item.id !== editing.value.id)
);

async function load() {
  const [treeRes, flatRes] = await Promise.all([
    request.get('/system/permissions'),
    request.get('/options/permissions'),
  ]);
  tree.value = treeRes.data || [];
  flat.value = flatRes.data || [];
}

function resetForm() {
  Object.assign(form, {
    parent_id: 0,
    name: '',
    code: '',
    type: 'menu',
    path: '',
    icon: '',
    component_path: '',
    sort: 0,
    status: 1,
  });
}

function openCreate(parentId = 0) {
  editing.value = null;
  resetForm();
  form.parent_id = parentId;
  dialogVisible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    parent_id: Number(row.parent_id || 0),
    name: row.name,
    code: row.code,
    type: row.type,
    path: row.path || '',
    icon: row.icon || '',
    component_path: row.component_path || '',
    sort: Number(row.sort || 0),
    status: Number(row.status ?? 1),
  });
  dialogVisible.value = true;
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  saving.value = true;
  try {
    if (editing.value) {
      await request.put(`/system/permissions/${editing.value.id}`, { ...form });
      ElMessage.success('已保存');
    } else {
      await request.post('/system/permissions', { ...form });
      ElMessage.success('已新增');
    }
    dialogVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  await ElMessageBox.confirm(`确定删除权限「${row.name}」？`, '删除确认', { type: 'warning' });
  await request.delete(`/system/permissions/${row.id}`);
  ElMessage.success('已删除');
  await load();
}

onMounted(load);
</script>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
</style>

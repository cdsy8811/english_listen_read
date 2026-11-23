<template>
  <div class="base-crud">
    <SearchForm
      v-if="config.search?.length"
      :items="config.search"
      :query-params="queryParams"
      @search="handleSearch"
      @reset="handleReset"
    />

    <div class="page-card">
      <div class="toolbar">
        <div class="toolbar-left">
          <el-button
            v-if="config.permissions?.add"
            v-permission="config.permissions.add"
            type="primary"
            icon="Plus"
            @click="openCreate"
          >
            {{ config.addText || '新增' }}
          </el-button>
          <el-button
            v-if="config.batchDelete !== false && config.permissions?.remove"
            v-permission="config.permissions.remove"
            type="danger"
            plain
            icon="Delete"
            :disabled="!selectedRows.length"
            @click="handleBatchDelete"
          >
            批量删除
          </el-button>
          <el-button
            v-if="config.permissions?.export"
            v-permission="config.permissions.export"
            icon="Download"
            @click="handleExport"
          >
            导出
          </el-button>
          <slot name="toolbar-left" />
        </div>
        <div class="toolbar-right">
          <slot name="toolbar-right" />
          <el-button icon="Refresh" circle title="刷新" @click="fetchData" />
        </div>
      </div>

      <CrudTable
        :data="rows"
        :columns="config.columns || []"
        :total="total"
        :page="page"
        :page-size="pageSize"
        :loading="loading"
        :selection="config.selection !== false"
        :row-key="config.rowKey || 'id'"
        :pagination="config.pagination !== false"
        :permissions="config.permissions || {}"
        :action-width="config.actionWidth"
        @selection-change="(rows) => (selectedRows = rows)"
        @page-change="handlePageChange"
        @size-change="handleSizeChange"
        @edit="openEdit"
        @delete="handleDelete"
        @sort-change="handleSort"
      >
        <template v-for="col in config.columns || []" #[`column-${col.prop}`]="scope" :key="col.prop">
          <slot :name="`column-${col.prop}`" v-bind="scope" />
        </template>
        <template #actions="scope">
          <slot name="actions" v-bind="scope" />
        </template>
      </CrudTable>
    </div>

    <CrudDialog
      v-model="dialogVisible"
      :title="editingRow ? (config.editTitle || '编辑') : (config.createTitle || '新增')"
      :width="config.dialogWidth || '640px'"
      :label-width="config.labelWidth || '110px'"
      :items="config.form || []"
      :rules="config.rules || {}"
      :initial-data="formData"
      :submit-loading="saving"
      @submit="handleSubmit"
    >
      <template v-for="item in config.form || []" #[`field-${item.prop}`]="scope" :key="item.prop">
        <slot :name="`field-${item.prop}`" v-bind="scope" />
      </template>
      <template #footer="scope">
        <slot name="dialog-footer" v-bind="scope" />
      </template>
    </CrudDialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '@admin/utils/request';
import SearchForm from './SearchForm.vue';
import CrudTable from './CrudTable.vue';
import CrudDialog from './CrudDialog.vue';

const props = defineProps({
  config: { type: Object, required: true },
});

const emit = defineEmits(['loaded', 'saved', 'deleted']);

const queryParams = reactive({});
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const dialogVisible = ref(false);
const editingRow = ref(null);
const formData = reactive({});
const saving = ref(false);
const selectedRows = ref([]);
const sort = reactive({ by: '', order: '' });

function initQuery() {
  (props.config.search || []).forEach((item) => {
    if (queryParams[item.prop] === undefined) queryParams[item.prop] = item.default ?? '';
  });
}

function requestParams() {
  const params = { ...queryParams, page: page.value, page_size: pageSize.value };
  if (sort.by) {
    params.sort_by = sort.by;
    params.sort_order = sort.order;
  }
  Object.keys(params).forEach((key) => {
    if (params[key] === '' || params[key] === null || params[key] === undefined) delete params[key];
  });
  return params;
}

async function fetchData() {
  loading.value = true;
  try {
    const res = await request.get(props.config.api, { params: requestParams() });
    rows.value = res.data?.list || [];
    total.value = Number(res.data?.total || 0);
    emit('loaded', res.data);
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  page.value = 1;
  fetchData();
}

function handleReset() {
  page.value = 1;
  fetchData();
}

function handlePageChange(value) {
  page.value = value;
  fetchData();
}

function handleSizeChange(value) {
  pageSize.value = value;
  page.value = 1;
  fetchData();
}

function handleSort(payload) {
  if (!payload?.prop) {
    sort.by = '';
    sort.order = '';
  } else {
    sort.by = payload.prop;
    sort.order = payload.order === 'ascending' ? 'asc' : 'desc';
  }
  fetchData();
}

function resetFormData() {
  Object.keys(formData).forEach((key) => delete formData[key]);
  (props.config.form || []).forEach((item) => {
    formData[item.prop] = item.type === 'switch' ? 0 : item.type === 'number' ? 0 : '';
  });
}

function openCreate() {
  editingRow.value = null;
  resetFormData();
  dialogVisible.value = true;
}

function openEdit(row) {
  editingRow.value = row;
  resetFormData();
  (props.config.form || []).forEach((item) => {
    if (item.type === 'password') return;
    const value = row[item.prop];
    if (value !== undefined && value !== null) formData[item.prop] = value;
  });
  dialogVisible.value = true;
}

async function handleSubmit(data) {
  saving.value = true;
  try {
    if (editingRow.value) {
      const id = editingRow.value[props.config.rowKey || 'id'];
      await request.put(`${props.config.api}/${id}`, data);
      ElMessage.success('保存成功');
    } else {
      await request.post(props.config.api, data);
      ElMessage.success('创建成功');
    }
    dialogVisible.value = false;
    emit('saved');
    await fetchData();
  } finally {
    saving.value = false;
  }
}

async function handleDelete(row) {
  await ElMessageBox.confirm('删除后不可恢复，确定继续？', '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  });

  const id = row[props.config.rowKey || 'id'];
  await request.delete(`${props.config.api}/${id}`);
  ElMessage.success('已删除');
  emit('deleted');
  await fetchData();
}

async function handleBatchDelete() {
  await ElMessageBox.confirm(`确定删除选中的 ${selectedRows.value.length} 条记录？`, '批量删除', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  });

  for (const row of selectedRows.value) {
    const id = row[props.config.rowKey || 'id'];
    await request.delete(`${props.config.api}/${id}`);
  }

  ElMessage.success('已删除');
  selectedRows.value = [];
  emit('deleted');
  await fetchData();
}

async function handleExport() {
  const blob = await request.get(props.config.exportApi || `${props.config.api}/export`, {
    params: requestParams(),
    responseType: 'blob',
  });
  const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = props.config.exportFilename || `export-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

onMounted(() => {
  initQuery();
  fetchData();
});

defineExpose({ refresh: fetchData, queryParams });
</script>

<style scoped>
.base-crud {
  min-width: 0;
}
</style>

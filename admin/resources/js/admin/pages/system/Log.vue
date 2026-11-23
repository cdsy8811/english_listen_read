<template>
  <div class="page">
    <h2 class="page-title">日志</h2>
    <p class="page-desc">操作日志只记录写操作与状态码，不保存请求体；登录日志记录成功与失败原因。</p>

    <el-tabs v-model="activeTab" class="log-tabs">
      <el-tab-pane label="操作日志" name="operation">
        <BaseCrud v-if="activeTab === 'operation'" :config="operationConfig" />
      </el-tab-pane>
      <el-tab-pane label="登录日志" name="login">
        <BaseCrud v-if="activeTab === 'login'" :config="loginConfig" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import BaseCrud from '@admin/components/BaseCrud/index.vue';

const activeTab = ref('operation');

const operationConfig = {
  api: '/system/operation-logs',
  selection: false,
  search: [
    { prop: 'keyword', label: '路径', width: '200px' },
    {
      prop: 'method',
      label: '方法',
      type: 'select',
      width: '120px',
      options: ['POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ label: value, value })),
    },
    { prop: 'created_at', label: '时间', type: 'date-range' },
  ],
  columns: [
    { prop: 'method', label: '方法', width: 90 },
    { prop: 'path', label: '路径', minWidth: 220 },
    { prop: 'status', label: '状态码', width: 90 },
    { prop: 'duration_ms', label: '耗时', width: 90, formatter: (row) => `${row.duration_ms} ms` },
    { prop: 'user_id', label: '管理员 ID', width: 100 },
    { prop: 'ip', label: 'IP', minWidth: 120 },
    { prop: 'created_at', label: '时间', minWidth: 150 },
  ],
};

const loginConfig = {
  api: '/system/login-logs',
  selection: false,
  search: [
    { prop: 'keyword', label: '账号', width: '180px' },
    {
      prop: 'success',
      label: '结果',
      type: 'select',
      width: '120px',
      options: [
        { label: '成功', value: 1 },
        { label: '失败', value: 0 },
      ],
    },
    { prop: 'created_at', label: '时间', type: 'date-range' },
  ],
  columns: [
    { prop: 'username', label: '账号', minWidth: 120 },
    { prop: 'user_type', label: '类型', width: 90 },
    {
      prop: 'success',
      label: '结果',
      width: 80,
      type: 'tag',
      dict: { 1: { label: '成功', type: 'success' }, 0: { label: '失败', type: 'danger' } },
    },
    { prop: 'message', label: '说明', minWidth: 160 },
    { prop: 'ip', label: 'IP', minWidth: 120 },
    { prop: 'created_at', label: '时间', minWidth: 150 },
  ],
};
</script>

<style scoped>
.log-tabs {
  margin-top: 4px;
}
</style>

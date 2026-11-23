<template>
  <div class="page">
    <h2 class="page-title">音频缓存</h2>
    <p class="page-desc">服务端按「文本 + 语种 + 发音人 + 语速」缓存合成结果；App 本地仍会再缓存一份。</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">缓存文件</div>
        <div class="stat-value">{{ stats.files }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">占用空间</div>
        <div class="stat-value">{{ mb(stats.bytes) }}<small>MB</small></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">命中次数</div>
        <div class="stat-value">{{ stats.hits }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">容量上限</div>
        <div class="stat-value">{{ stats.limit_mb }}<small>MB</small></div>
      </div>
    </div>

    <BaseCrud ref="crudRef" :config="config">
      <template #toolbar-left>
        <el-button type="danger" plain icon="Delete" @click="clearAll">清空缓存</el-button>
      </template>
    </BaseCrud>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import BaseCrud from '@admin/components/BaseCrud/index.vue';
import request from '@admin/utils/request';

const crudRef = ref();
const stats = reactive({ files: 0, bytes: 0, hits: 0, limit_mb: 2048 });

const config = {
  api: '/ai/tts-assets',
  selection: false,
  permissions: { remove: 'ai:tts_cache' },
  columns: [
    { prop: 'hash', label: '缓存键', minWidth: 200 },
    { prop: 'lang', label: '语种', width: 80 },
    { prop: 'vcn', label: '发音人', minWidth: 160 },
    { prop: 'speed', label: '语速', width: 80 },
    { prop: 'bytes', label: '大小', width: 100, formatter: (row) => `${(row.bytes / 1024).toFixed(1)} KB` },
    { prop: 'hits', label: '命中', width: 80 },
    { prop: 'last_used_at', label: '最后使用', minWidth: 150 },
  ],
};

function mb(bytes) {
  return ((bytes || 0) / 1024 / 1024).toFixed(1);
}

async function loadStats() {
  const res = await request.get('/ai/tts-stats');
  Object.assign(stats, res.data || {});
}

async function clearAll() {
  await ElMessageBox.confirm('清空后所有音频需要重新合成，确定继续？', '清空缓存', { type: 'warning' });
  await request.post('/ai/tts-assets/clear');
  ElMessage.success('缓存已清空');
  await loadStats();
  crudRef.value?.refresh();
}

onMounted(loadStats);
</script>

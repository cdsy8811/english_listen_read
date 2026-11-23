<template>
  <div class="page">
    <h2 class="page-title">AI 调用日志</h2>
    <p class="page-desc">记录 OCR、抽取、判分、词典、合成、听写等调用；不记录密钥、签名串与图片内容。</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">累计调用</div>
        <div class="stat-value">{{ summary.total }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日调用</div>
        <div class="stat-value">{{ summary.today }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">失败次数</div>
        <div class="stat-value">{{ summary.errors }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">平均耗时</div>
        <div class="stat-value">{{ summary.avg_latency_ms }}<small>ms</small></div>
      </div>
    </div>

    <BaseCrud ref="crudRef" :config="config" />

    <div v-if="summary.by_capability?.length" class="page-card capability-card">
      <h3>能力分布</h3>
      <div class="caps">
        <el-tag
          v-for="item in summary.by_capability"
          :key="item.capability"
          effect="plain"
          :type="item.errors ? 'warning' : 'success'"
          size="large"
        >
          {{ label(item.capability) }} · {{ item.total }} 次
          <span v-if="item.errors">（失败 {{ item.errors }}）</span>
        </el-tag>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import BaseCrud from '@admin/components/BaseCrud/index.vue';
import request from '@admin/utils/request';

const crudRef = ref();
const summary = reactive({ total: 0, today: 0, errors: 0, avg_latency_ms: 0, by_capability: [] });

const labels = {
  ocr: '拍照 OCR',
  extract: '词条抽取',
  evaluate: '内容判分',
  dict: '词典',
  gloss: '点词速览',
  tts: '语音合成',
  asr: '语音听写',
  passage_translate: '逐句翻译',
  passage_evaluate: '跟读检查',
};

function label(code) {
  return labels[code] || code;
}

const config = reactive({
  api: '/ai/call-logs',
  selection: false,
  search: [
    { prop: 'app_user_id', label: '账号', type: 'select', width: '180px', options: [] },
    {
      prop: 'capability',
      label: '能力',
      type: 'select',
      width: '150px',
      options: Object.keys(labels).map((value) => ({ label: labels[value], value })),
    },
    {
      prop: 'status',
      label: '状态',
      type: 'select',
      width: '120px',
      options: [
        { label: '成功', value: 'ok' },
        { label: '失败', value: 'error' },
      ],
    },
    { prop: 'created_at', label: '时间', type: 'date-range' },
  ],
  columns: [
    { prop: 'capability', label: '能力', minWidth: 120, formatter: (row) => label(row.capability) },
    { prop: 'app_user', label: '账号', minWidth: 110 },
    { prop: 'model', label: '模型', minWidth: 110 },
    { prop: 'latency_ms', label: '耗时', width: 90, formatter: (row) => `${row.latency_ms} ms` },
    {
      prop: 'status',
      label: '状态',
      width: 80,
      type: 'tag',
      dict: { ok: { label: '成功', type: 'success' }, error: { label: '失败', type: 'danger' } },
    },
    { prop: 'error_code', label: '错误码', width: 110 },
    { prop: 'created_at', label: '时间', minWidth: 150 },
  ],
});

async function loadSummary() {
  const res = await request.get('/ai/summary');
  Object.assign(summary, res.data || {});
}

async function loadOptions() {
  const res = await request.get('/options/app-users', { params: { page_size: 100 } });
  config.search[0].options = (res.data || []).map((user) => ({
    label: `${user.nickname || user.username}（${user.username}）`,
    value: user.id,
  }));
}

onMounted(() => {
  loadOptions();
  loadSummary();
});
</script>

<style scoped>
.capability-card {
  margin-top: 14px;
}

.capability-card h3 {
  margin: 0 0 10px;
  font-size: 15px;
}

.caps {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
</style>

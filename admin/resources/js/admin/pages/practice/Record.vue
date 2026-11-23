<template>
  <div class="page">
    <h2 class="page-title">练习记录</h2>
    <p class="page-desc">每次作答都会留一条记录；默写记录会带 dictation 标记。</p>

    <BaseCrud ref="crudRef" :config="config">
      <template #actions="{ row }">
        <el-button link type="primary" @click="openDetail(row)">详情</el-button>
      </template>
    </BaseCrud>

    <el-dialog v-model="detailVisible" title="判分明细" width="760px" destroy-on-close>
      <el-descriptions v-if="current" :column="2" border size="small">
        <el-descriptions-item label="词条">{{ current.word || current.word_uuid }}</el-descriptions-item>
        <el-descriptions-item label="释义">{{ current.translation || '-' }}</el-descriptions-item>
        <el-descriptions-item label="模式">{{ current.mode }}</el-descriptions-item>
        <el-descriptions-item label="输入方式">{{ current.input_type || '-' }}</el-descriptions-item>
        <el-descriptions-item label="分数">{{ current.score }}</el-descriptions-item>
        <el-descriptions-item label="时间">{{ current.created_at }}</el-descriptions-item>
        <el-descriptions-item label="作答" :span="2">{{ current.raw_text || '-' }}</el-descriptions-item>
        <el-descriptions-item label="转写" :span="2">{{ current.asr_text || '-' }}</el-descriptions-item>
      </el-descriptions>
      <div class="json-box">
        <div class="json-title">detail_json</div>
        <pre>{{ pretty(current?.detail) }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import BaseCrud from '@admin/components/BaseCrud/index.vue';
import request from '@admin/utils/request';

const crudRef = ref();
const detailVisible = ref(false);
const current = ref(null);

const config = reactive({
  api: '/practice-records',
  selection: false,
  search: [
    { prop: 'app_user_id', label: '账号', type: 'select', width: '180px', options: [] },
    {
      prop: 'mode',
      label: '模式',
      type: 'select',
      width: '130px',
      options: [
        { label: '2.1 中英共读', value: '2.1' },
        { label: '2.2 看中说英', value: '2.2' },
        { label: '2.3 看英说中', value: '2.3' },
      ],
    },
    {
      prop: 'input_type',
      label: '输入',
      type: 'select',
      width: '130px',
      options: [
        { label: '录音', value: 'record' },
        { label: '打字', value: 'input' },
        { label: '已掌握', value: 'mastered' },
      ],
    },
    { prop: 'created_at', label: '作答时间', type: 'date-range' },
  ],
  columns: [
    { prop: 'word', label: '词条', minWidth: 130 },
    { prop: 'translation', label: '释义', minWidth: 150, showOverflowTooltip: true },
    { prop: 'mode', label: '模式', width: 80 },
    { prop: 'input_type', label: '输入', width: 90 },
    { prop: 'score', label: '分数', width: 70 },
    { prop: 'raw_text', label: '作答', minWidth: 140, showOverflowTooltip: true },
    { prop: 'asr_text', label: '转写', minWidth: 140, showOverflowTooltip: true },
    { prop: 'created_at', label: '时间', minWidth: 150 },
  ],
});

function pretty(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function openDetail(row) {
  current.value = row;
  detailVisible.value = true;
}

async function loadOptions() {
  const res = await request.get('/options/app-users', { params: { page_size: 100 } });
  config.search[0].options = (res.data || []).map((user) => ({
    label: `${user.nickname || user.username}（${user.username}）`,
    value: user.id,
  }));
}

onMounted(loadOptions);
</script>

<style scoped>
.json-box {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.json-title {
  padding: 8px 12px;
  background: #f8fafc;
  font-size: 12px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}

pre {
  margin: 0;
  padding: 12px;
  max-height: 320px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  background: #fff;
}
</style>

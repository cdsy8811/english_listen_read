<template>
  <div class="page">
    <h2 class="page-title">学习统计</h2>
    <p class="page-desc">一次练习 / 跟读 = 一条学习会话，统计时长、作答数与平均分。</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">会话总数</div>
        <div class="stat-value">{{ summary.total }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">累计时长</div>
        <div class="stat-value">{{ Math.round(summary.duration / 60) }}<small>分钟</small></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">平均分</div>
        <div class="stat-value">{{ summary.avg_score }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">近 14 天会话</div>
        <div class="stat-value">{{ recentSessions }}</div>
      </div>
    </div>

    <div class="page-card chart-card">
      <div class="card-head">
        <h3>近 14 天学习时长</h3>
        <el-tag size="small" effect="plain" type="warning">分钟</el-tag>
      </div>
      <div ref="chartRef" class="chart-box"></div>
    </div>

    <BaseCrud ref="crudRef" :config="config" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import * as echarts from 'echarts';
import BaseCrud from '@admin/components/BaseCrud/index.vue';
import request from '@admin/utils/request';

const crudRef = ref();
const summary = reactive({ total: 0, duration: 0, avg_score: 0, trend: [] });
const chartRef = ref();
let chart = null;

const recentSessions = computed(() => summary.trend.reduce((sum, item) => sum + item.sessions, 0));

const config = reactive({
  api: '/study/sessions',
  selection: false,
  search: [
    { prop: 'app_user_id', label: '账号', type: 'select', width: '180px', options: [] },
    {
      prop: 'kind',
      label: '类型',
      type: 'select',
      width: '130px',
      options: [
        { label: '词条练习', value: 'practice' },
        { label: '短文跟读', value: 'read' },
      ],
    },
    {
      prop: 'mode',
      label: '模式',
      type: 'select',
      width: '130px',
      options: [
        { label: '2.1 中英共读', value: '2.1' },
        { label: '2.2 看中说英', value: '2.2' },
        { label: '2.3 看英说中', value: '2.3' },
        { label: '默写', value: 'dictation' },
        { label: '跟读', value: 'read' },
      ],
    },
    { prop: 'keyword', label: '标题', width: '180px' },
    { prop: 'created_at', label: '时间', type: 'date-range' },
  ],
  columns: [
    { prop: 'title', label: '内容', minWidth: 180 },
    { prop: 'kind', label: '类型', width: 90, type: 'tag', dict: { practice: { label: '练习', type: 'warning' }, read: { label: '跟读', type: 'success' } } },
    { prop: 'mode', label: '模式', width: 90 },
    { prop: 'duration_sec', label: '时长', width: 90, formatter: (row) => `${row.duration_sec} 秒` },
    { prop: 'total', label: '计划', width: 70 },
    { prop: 'answered', label: '作答', width: 70 },
    { prop: 'passed', label: '达标', width: 70 },
    { prop: 'avg_score', label: '均分', width: 70 },
    { prop: 'created_at', label: '时间', minWidth: 150 },
  ],
});

async function loadSummary() {
  const res = await request.get('/study/summary', { params: { days: 14 } });
  Object.assign(summary, res.data || {});
  await nextTick();
  renderChart();
}

function renderChart() {
  if (!chartRef.value) return;
  if (!chart) chart = echarts.init(chartRef.value);
  const trend = summary.trend || [];
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 28 },
    xAxis: {
      type: 'category',
      data: trend.map((item) => item.day.slice(5)),
      axisLabel: { color: '#6b7280' },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6b7280' },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    series: [
      {
        type: 'bar',
        name: '学习时长（分钟）',
        data: trend.map((item) => Math.round(item.duration / 60)),
        barMaxWidth: 22,
        itemStyle: { color: '#f97316', borderRadius: [6, 6, 0, 0] },
      },
    ],
  });
}

async function loadOptions() {
  const res = await request.get('/options/app-users', { params: { page_size: 100 } });
  config.search[0].options = (res.data || []).map((user) => ({
    label: `${user.nickname || user.username}（${user.username}）`,
    value: user.id,
  }));
}

function resize() {
  chart?.resize();
}

onMounted(() => {
  loadOptions();
  loadSummary();
  window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  chart?.dispose();
});
</script>

<style scoped>
.chart-card {
  margin: 14px 0;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.card-head h3 {
  margin: 0;
  font-size: 15px;
}
</style>

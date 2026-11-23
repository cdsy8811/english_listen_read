<template>
  <div class="page" v-loading="loading">
    <div class="hero">
      <div>
        <h2>工作台</h2>
        <p>橙子英语云端数据总览，数据来自 App 增量同步与 AI 调用日志。</p>
      </div>
      <el-button icon="Refresh" @click="load">刷新</el-button>
    </div>

    <div class="stat-grid">
      <div v-for="item in statItems" :key="item.key" class="stat-card">
        <div class="stat-label">{{ item.label }}</div>
        <div class="stat-value">
          {{ item.value }}<small v-if="item.unit">{{ item.unit }}</small>
        </div>
      </div>
    </div>

    <div class="page-card chart-card">
      <div class="card-head">
        <div>
          <h3>近 14 天活跃趋势</h3>
          <p>学习会话、练习次数、AI 调用次数</p>
        </div>
        <el-tag size="small" effect="plain" type="warning">按天统计</el-tag>
      </div>
      <div ref="chartRef" class="chart-box"></div>
    </div>

    <div class="two-col">
      <div class="page-card">
        <div class="card-head">
          <div>
            <h3>最近注册用户</h3>
            <p>按创建时间倒序</p>
          </div>
          <el-button link type="primary" @click="$router.push('/app-users')">全部用户</el-button>
        </div>
        <el-table :data="recentUsers" size="small" stripe>
          <el-table-column prop="username" label="账号" min-width="110" />
          <el-table-column prop="nickname" label="昵称" min-width="100" />
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 1 ? 'success' : 'info'" effect="plain">
                {{ row.status === 1 ? '正常' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="注册时间" min-width="150" />
        </el-table>
      </div>

      <div class="page-card">
        <div class="card-head">
          <div>
            <h3>AI 能力分布</h3>
            <p>近 14 天调用次数</p>
          </div>
          <el-button link type="primary" @click="$router.push('/ai/call-logs')">调用日志</el-button>
        </div>
        <el-empty v-if="!aiByCapability.length" description="暂无 AI 调用" :image-size="80" />
        <div v-else class="cap-list">
          <div v-for="item in aiByCapability" :key="item.capability" class="cap-item">
            <div class="cap-name">{{ capabilityLabel(item.capability) }}</div>
            <el-progress :percentage="capPercent(item.total)" :stroke-width="10" :show-text="false" color="#f97316" />
            <div class="cap-value">{{ item.total }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import * as echarts from 'echarts';
import request from '@admin/utils/request';

const loading = ref(false);
const data = ref({ counts: {}, trends: [], recent_users: [], ai_by_capability: [] });
const chartRef = ref();
let chart = null;

const labels = {
  app_users: 'App 用户',
  devices: '设备',
  units: '词库单元',
  words: '词条',
  practice_records: '练习记录',
  study_sessions: '学习会话',
  ai_calls_today: '今日 AI 调用',
};

const statItems = computed(() =>
  Object.keys(labels).map((key) => ({
    key,
    label: labels[key],
    value: data.value.counts?.[key] ?? 0,
  }))
);

const recentUsers = computed(() => data.value.recent_users || []);
const aiByCapability = computed(() => data.value.ai_by_capability || []);
const maxCap = computed(() => Math.max(1, ...aiByCapability.value.map((item) => item.total)));

function capPercent(value) {
  return Math.round((value / maxCap.value) * 100);
}

function capabilityLabel(code) {
  const map = {
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
  return map[code] || code;
}

async function load() {
  loading.value = true;
  try {
    const res = await request.get('/dashboard');
    data.value = res.data || {};
    await nextTick();
    renderChart();
  } finally {
    loading.value = false;
  }
}

function renderChart() {
  if (!chartRef.value) return;
  if (!chart) chart = echarts.init(chartRef.value);

  const trends = data.value.trends || [];
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['学习会话', '练习次数', 'AI 调用'], top: 0 },
    grid: { left: 36, right: 20, top: 42, bottom: 28 },
    xAxis: {
      type: 'category',
      data: trends.map((item) => item.day.slice(5)),
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: { color: '#6b7280' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      axisLabel: { color: '#6b7280' },
    },
    series: [
      {
        name: '学习会话',
        type: 'line',
        smooth: true,
        data: trends.map((item) => item.sessions),
        itemStyle: { color: '#f97316' },
        areaStyle: { color: 'rgba(249,115,22,0.12)' },
      },
      {
        name: '练习次数',
        type: 'line',
        smooth: true,
        data: trends.map((item) => item.records),
        itemStyle: { color: '#0ea5e9' },
      },
      {
        name: 'AI 调用',
        type: 'line',
        smooth: true,
        data: trends.map((item) => item.ai_calls),
        itemStyle: { color: '#8b5cf6' },
      },
    ],
  });
}

function resize() {
  chart?.resize();
}

onMounted(() => {
  load();
  window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  chart?.dispose();
});
</script>

<style scoped>
.hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.hero h2 {
  margin: 0;
  font-size: 22px;
}

.hero p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.chart-card {
  margin-top: 14px;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.card-head h3 {
  margin: 0;
  font-size: 15px;
}

.card-head p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.two-col {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.65fr);
  gap: 14px;
  margin-top: 14px;
}

.cap-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 4px;
}

.cap-item {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr) 40px;
  align-items: center;
  gap: 10px;
}

.cap-name {
  font-size: 13px;
  color: #374151;
}

.cap-value {
  font-size: 13px;
  color: var(--text-muted);
  text-align: right;
}

@media (max-width: 1024px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>

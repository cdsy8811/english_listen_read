<template>
  <div class="page" v-loading="loading">
    <div class="head">
      <el-button icon="ArrowLeft" @click="$router.push('/app-users')">返回</el-button>
      <div>
        <h2 class="page-title">{{ data.user?.nickname || data.user?.username || '用户详情' }}</h2>
        <p class="page-desc">账号 {{ data.user?.username }} · UUID {{ data.user?.uuid }}</p>
      </div>
      <div class="head-actions">
        <el-tag :type="data.user?.status === 1 ? 'success' : 'info'" effect="plain">
          {{ data.user?.status === 1 ? '正常' : '禁用' }}
        </el-tag>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">设备</div>
        <div class="stat-value">{{ data.user?.devices_count || 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">词库单元</div>
        <div class="stat-value">{{ data.user?.units_count || 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">词条</div>
        <div class="stat-value">{{ data.user?.words_count || 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">练习记录</div>
        <div class="stat-value">{{ data.user?.records_count || 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">学习会话</div>
        <div class="stat-value">{{ data.user?.sessions_count || 0 }}</div>
      </div>
    </div>

    <div class="grid">
      <div class="page-card">
        <h3>账号信息</h3>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="账号">{{ data.user?.username || '-' }}</el-descriptions-item>
          <el-descriptions-item label="昵称">{{ data.user?.nickname || '-' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ data.user?.status === 1 ? '正常' : '禁用' }}</el-descriptions-item>
          <el-descriptions-item label="最后登录">{{ data.user?.last_login_at || '-' }}</el-descriptions-item>
          <el-descriptions-item label="最后 IP">{{ data.user?.last_login_ip || '-' }}</el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ data.user?.created_at || '-' }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="page-card">
        <h3>设备</h3>
        <el-table :data="data.devices || []" size="small" stripe empty-text="暂无设备">
          <el-table-column prop="name" label="设备" min-width="110">
            <template #default="{ row }">{{ row.name || row.device_id }}</template>
          </el-table-column>
          <el-table-column prop="platform" label="平台" width="90" />
          <el-table-column prop="app_version" label="版本" width="90" />
          <el-table-column prop="last_seen_at" label="最后在线" min-width="150" />
        </el-table>
      </div>
    </div>

    <div class="grid">
      <div class="page-card">
        <div class="card-head">
          <h3>最近练习</h3>
          <el-button link type="primary" @click="$router.push('/practice-records')">全部记录</el-button>
        </div>
        <el-table :data="data.recent_practice || []" size="small" stripe empty-text="暂无练习记录">
          <el-table-column prop="word_uuid" label="词条" min-width="120" />
          <el-table-column prop="mode" label="模式" width="80" />
          <el-table-column prop="score" label="分数" width="70" />
          <el-table-column prop="created_at" label="时间" min-width="150">
            <template #default="{ row }">{{ formatMs(row.created_at) }}</template>
          </el-table-column>
        </el-table>
      </div>

      <div class="page-card">
        <div class="card-head">
          <h3>最近学习会话</h3>
          <el-button link type="primary" @click="$router.push('/study-sessions')">全部会话</el-button>
        </div>
        <el-table :data="data.recent_sessions || []" size="small" stripe empty-text="暂无学习会话">
          <el-table-column prop="title" label="内容" min-width="150" />
          <el-table-column prop="mode" label="模式" width="80" />
          <el-table-column prop="duration_sec" label="时长" width="80">
            <template #default="{ row }">{{ Math.round((row.duration_sec || 0) / 60) }} 分钟</template>
          </el-table-column>
          <el-table-column prop="created_at" label="时间" min-width="150">
            <template #default="{ row }">{{ formatMs(row.created_at) }}</template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import request from '@admin/utils/request';

const route = useRoute();
const loading = ref(false);
const data = ref({ user: null, devices: [], recent_practice: [], recent_sessions: [] });

function formatMs(value) {
  if (!value) return '-';
  return new Date(Number(value)).toLocaleString('zh-CN', { hour12: false });
}

async function load() {
  loading.value = true;
  try {
    const res = await request.get(`/app-users/${route.params.id}`);
    data.value = res.data || {};
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}

.head-actions {
  margin-left: auto;
}

.grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.2fr);
  gap: 14px;
  margin-top: 14px;
}

.page-card h3 {
  margin: 0 0 10px;
  font-size: 15px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

@media (max-width: 1024px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>

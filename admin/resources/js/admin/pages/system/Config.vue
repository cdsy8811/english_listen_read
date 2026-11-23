<template>
  <div class="page" v-loading="loading">
    <div class="head">
      <div>
        <h2 class="page-title">系统配置</h2>
        <p class="page-desc">站点名称、AI 配额、同步协议版本等；保存后 App API 立即生效。</p>
      </div>
      <el-button type="primary" icon="Check" :loading="saving" @click="save">保存全部</el-button>
    </div>

    <div v-for="(items, group) in groups" :key="group" class="page-card group-card">
      <div class="group-head">
        <h3>{{ groupLabel(group) }}</h3>
        <el-tag size="small" effect="plain">{{ items.length }} 项</el-tag>
      </div>
      <el-form label-width="160px">
        <el-form-item v-for="item in items" :key="item.key" :label="item.remark || item.key">
          <el-input v-model="item.value" style="max-width: 520px" />
          <span class="key">{{ item.key }}</span>
        </el-form-item>
      </el-form>
    </div>

    <el-empty v-if="!Object.keys(groups).length && !loading" description="暂无配置" />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import request from '@admin/utils/request';

const loading = ref(false);
const saving = ref(false);
const groups = ref({});

const groupLabels = {
  basic: '基础信息',
  ai: 'AI 与配额',
  app: 'App 设置',
  sync: '同步设置',
};

function groupLabel(group) {
  return groupLabels[group] || group;
}

async function load() {
  loading.value = true;
  try {
    const res = await request.get('/system/configs');
    groups.value = res.data || {};
  } finally {
    loading.value = false;
  }
}

async function save() {
  const items = [];
  Object.values(groups.value).forEach((list) => {
    list.forEach((item) => {
      items.push({ key: item.key, value: item.value, group: item.group, remark: item.remark });
    });
  });

  saving.value = true;
  try {
    const res = await request.post('/system/configs', { items });
    groups.value = res.data || groups.value;
    ElMessage.success('配置已保存');
  } finally {
    saving.value = false;
  }
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

.group-card + .group-card {
  margin-top: 14px;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.group-head h3 {
  margin: 0;
  font-size: 15px;
}

.key {
  margin-left: 12px;
  color: #9ca3af;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
</style>

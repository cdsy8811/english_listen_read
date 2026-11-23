<template>
  <div class="page">
    <h2 class="page-title">跟读</h2>
    <p class="page-desc">查看用户添加的英文短文、逐句中文与跟读记录。</p>

    <BaseCrud ref="crudRef" :config="config">
      <template #actions="{ row }">
        <el-button link type="primary" @click="openDetail(row)">查看</el-button>
      </template>
    </BaseCrud>

    <el-dialog v-model="detailVisible" :title="current?.title || '短文详情'" width="820px" destroy-on-close>
      <div v-if="current" class="article">
        <div v-for="(sentence, index) in current.sentences" :key="index" class="sentence">
          <div class="sentence-en">{{ sentence }}</div>
          <div class="sentence-zh">{{ current.translations?.[index] || '（暂无译文）' }}</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import BaseCrud from '@admin/components/BaseCrud/index.vue';
import request from '@admin/utils/request';

const crudRef = ref();
const detailVisible = ref(false);
const current = ref(null);
const options = ref([]);

const config = reactive({
  api: '/read/articles',
  actionWidth: 150,
  permissions: { remove: 'read:remove' },
  search: [
    { prop: 'app_user_id', label: '账号', type: 'select', width: '180px', options: [] },
    { prop: 'keyword', label: '标题', width: '200px' },
    { prop: 'created_at', label: '创建时间', type: 'date-range' },
  ],
  columns: [
    { prop: 'title', label: '标题', minWidth: 200 },
    { prop: 'app_user_id', label: '用户 ID', width: 90 },
    { prop: 'sentences_count', label: '句子数', width: 90 },
    {
      prop: 'translations',
      label: '译文',
      width: 90,
      formatter: (row) => `${(row.translations || []).filter(Boolean).length} 句`,
    },
    { prop: 'created_at', label: '创建时间', minWidth: 150 },
  ],
});

const detailCount = computed(() => current.value?.sentences?.length || 0);

function openDetail(row) {
  current.value = row;
  detailVisible.value = true;
}

async function loadOptions() {
  const res = await request.get('/options/app-users', { params: { page_size: 100 } });
  options.value = (res.data || []).map((user) => ({
    label: `${user.nickname || user.username}（${user.username}）`,
    value: user.id,
  }));
  config.search[0].options = options.value;
}

onMounted(loadOptions);
</script>

<style scoped>
.article {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 60vh;
  overflow: auto;
}

.sentence {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fffdf9;
}

.sentence-en {
  font-size: 15px;
  line-height: 1.7;
}

.sentence-zh {
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 13px;
}
</style>

<template>
  <div class="page">
    <h2 class="page-title">跟读</h2>
    <p class="page-desc">查看用户添加的英文短文、逐句中文与跟读记录。</p>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="短文" name="articles">
        <BaseCrud v-if="activeTab === 'articles'" ref="crudRef" :config="config">
          <template #actions="{ row }">
            <el-button link type="primary" @click="openDetail(row)">查看</el-button>
          </template>
        </BaseCrud>
      </el-tab-pane>

      <el-tab-pane label="跟读记录" name="records">
        <BaseCrud v-if="activeTab === 'records'" :config="recordConfig" />
      </el-tab-pane>
    </el-tabs>

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
import { onMounted, reactive, ref } from 'vue';
import BaseCrud from '@admin/components/BaseCrud/index.vue';
import request from '@admin/utils/request';

const activeTab = ref('articles');
const crudRef = ref();
const detailVisible = ref(false);
const current = ref(null);

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

const recordConfig = reactive({
  api: '/read/records',
  selection: false,
  search: [
    { prop: 'app_user_id', label: '账号', type: 'select', width: '180px', options: [] },
    { prop: 'created_at', label: '时间', type: 'date-range' },
  ],
  columns: [
    { prop: 'article_title', label: '文章', minWidth: 200 },
    { prop: 'sentence_index', label: '句序', width: 80, formatter: (row) => `第 ${row.sentence_index + 1} 句` },
    { prop: 'score', label: '分数', width: 80 },
    { prop: 'asr_text', label: '转写', minWidth: 240 },
    { prop: 'created_at', label: '时间', minWidth: 150 },
  ],
});

function openDetail(row) {
  current.value = row;
  detailVisible.value = true;
}

async function loadOptions() {
  const res = await request.get('/options/app-users', { params: { page_size: 100 } });
  const options = (res.data || []).map((user) => ({
    label: `${user.nickname || user.username}（${user.username}）`,
    value: user.id,
  }));
  config.search[0].options = options;
  recordConfig.search[0].options = options;
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

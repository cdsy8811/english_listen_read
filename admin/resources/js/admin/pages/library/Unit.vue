<template>
  <div class="page">
    <h2 class="page-title">词库</h2>
    <p class="page-desc">按账号查看单元与词条；后台修改会通过同步序号下发给 App。</p>

    <BaseCrud ref="crudRef" :config="config">
      <template #actions="{ row }">
        <el-button link type="primary" @click="openWords(row)">词条</el-button>
      </template>
    </BaseCrud>

    <el-drawer v-model="drawerVisible" :title="`词条 · ${currentUnit?.title || ''}`" size="760px" destroy-on-close>
      <div class="toolbar">
        <div class="toolbar-left">
          <el-input v-model="wordKeyword" placeholder="搜索单词 / 释义" clearable style="width: 220px" @keyup.enter="loadWords" @clear="loadWords" />
          <el-button type="primary" icon="Search" @click="loadWords">查询</el-button>
        </div>
        <div class="toolbar-right">
          <el-button type="primary" icon="Plus" @click="openWordCreate">新增词条</el-button>
          <el-button icon="Download" @click="exportWords">导出</el-button>
        </div>
      </div>

      <el-table v-loading="wordLoading" :data="words" border stripe empty-text="暂无词条">
        <el-table-column prop="word" label="单词" min-width="110" />
        <el-table-column prop="phonetic_us" label="音标" min-width="110" />
        <el-table-column prop="pos" label="词性" width="70" />
        <el-table-column prop="translation" label="释义" min-width="150" show-overflow-tooltip />
        <el-table-column label="错词" width="70">
          <template #default="{ row }">
            <el-tag v-if="row.wrong === 1" type="danger" size="small" effect="plain">错 {{ row.wrong_count }}</el-tag>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openWordEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="deleteWord(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>

    <CrudDialog
      v-model="wordDialogVisible"
      :title="editingWord ? '编辑词条' : '新增词条'"
      width="720px"
      :items="wordForm"
      :initial-data="wordData"
      :submit-loading="wordSaving"
      @submit="submitWord"
    />
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import BaseCrud from '@admin/components/BaseCrud/index.vue';
import CrudDialog from '@admin/components/BaseCrud/CrudDialog.vue';
import request from '@admin/utils/request';
import { useUserStore } from '@admin/stores/user';

const store = useUserStore();
const crudRef = ref();
const appUsers = ref([]);

const config = reactive({
  api: '/library/units',
  createTitle: '新增词库单元',
  editTitle: '编辑词库单元',
  dialogWidth: '620px',
  actionWidth: 220,
  permissions: {
    add: 'library:add',
    edit: 'library:edit',
    remove: 'library:remove',
  },
  search: [
    {
      prop: 'app_user_id',
      label: '账号',
      type: 'select',
      width: '180px',
      options: [],
    },
    { prop: 'keyword', label: '单元名', width: '200px' },
  ],
  columns: [
    { prop: 'title', label: '单元名称', minWidth: 180 },
    {
      prop: 'app_user',
      label: '账号',
      minWidth: 120,
      formatter: (row) => row.app_user?.nickname || row.app_user?.username || '-',
    },
    { prop: 'words_count', label: '词条数', width: 90 },
    { prop: 'created_at', label: '创建时间', minWidth: 150 },
  ],
  form: [
    {
      prop: 'app_user_id',
      label: '所属账号',
      type: 'select',
      span: 12,
      options: [],
      hint: '创建后归属账号不可迁移',
    },
    { prop: 'title', label: '单元名称', span: 12 },
    { prop: 'source_img', label: '来源图片', span: 24, hint: '可留空；仅记录本地来源标识' },
  ],
  rules: {
    app_user_id: [{ required: true, message: '请选择账号', trigger: 'change' }],
    title: [{ required: true, message: '请输入单元名称', trigger: 'blur' }],
  },
});

const drawerVisible = ref(false);
const currentUnit = ref(null);
const words = ref([]);
const wordKeyword = ref('');
const wordLoading = ref(false);
const wordDialogVisible = ref(false);
const editingWord = ref(null);
const wordSaving = ref(false);
const wordData = reactive({});

const wordForm = [
  { prop: 'word', label: '单词', span: 12 },
  { prop: 'pos', label: '词性', span: 12 },
  { prop: 'phonetic_us', label: '美式音标', span: 12 },
  { prop: 'phonetic_uk', label: '英式音标', span: 12 },
  { prop: 'translation', label: '中文释义', type: 'textarea', span: 24, rows: 2 },
  { prop: 'example', label: '例句', type: 'textarea', span: 24, rows: 2 },
  { prop: 'sort', label: '排序', type: 'number', span: 12 },
  {
    prop: 'wrong',
    label: '错词标记',
    type: 'select',
    span: 12,
    options: [
      { label: '正常', value: 0 },
      { label: '错词', value: 1 },
    ],
    default: 0,
  },
];

async function loadOptions() {
  const res = await request.get('/options/app-users', { params: { page_size: 100 } });
  appUsers.value = res.data || [];
  const options = appUsers.value.map((user) => ({
    label: `${user.nickname || user.username}（${user.username}）`,
    value: user.id,
  }));
  config.search[0].options = options;
  config.form[0].options = options;
}

function openWords(unit) {
  currentUnit.value = unit;
  wordKeyword.value = '';
  drawerVisible.value = true;
  loadWords();
}

async function loadWords() {
  if (!currentUnit.value) return;
  wordLoading.value = true;
  try {
    const res = await request.get('/library/words', {
      params: { unit_uuid: currentUnit.value.uuid, keyword: wordKeyword.value, page_size: 200 },
    });
    words.value = res.data?.list || [];
  } finally {
    wordLoading.value = false;
  }
}

function resetWordData(row = null) {
  Object.keys(wordData).forEach((key) => delete wordData[key]);
  wordForm.forEach((item) => {
    wordData[item.prop] = row?.[item.prop] ?? (item.type === 'number' ? 0 : item.default ?? '');
  });
}

function openWordCreate() {
  editingWord.value = null;
  resetWordData();
  wordDialogVisible.value = true;
}

function openWordEdit(row) {
  editingWord.value = row;
  resetWordData(row);
  wordDialogVisible.value = true;
}

async function submitWord(data) {
  if (!data.word?.trim()) {
    ElMessage.warning('请输入单词');
    return;
  }

  wordSaving.value = true;
  try {
    if (editingWord.value) {
      await request.put(`/library/words/${editingWord.value.id}`, data);
      ElMessage.success('已保存');
    } else {
      await request.post(`/library/units/${currentUnit.value.id}/words`, data);
      ElMessage.success('已新增');
    }
    wordDialogVisible.value = false;
    await loadWords();
    crudRef.value?.refresh();
  } finally {
    wordSaving.value = false;
  }
}

async function deleteWord(row) {
  await ElMessageBox.confirm(`确定删除词条「${row.word}」？`, '删除确认', { type: 'warning' });
  await request.delete(`/library/words/${row.id}`);
  ElMessage.success('已删除');
  await loadWords();
  crudRef.value?.refresh();
}

async function exportWords() {
  const blob = await request.get('/library/words/export', {
    params: { unit_uuid: currentUnit.value.uuid },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `words-${currentUnit.value.title}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

onMounted(loadOptions);
</script>

<style scoped>
:deep(.el-drawer__body) {
  padding: 12px 16px;
}
</style>

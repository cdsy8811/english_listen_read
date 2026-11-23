<template>
  <el-form class="search-form" :inline="true" @submit.prevent="emitSearch">
    <el-form-item v-for="item in items" :key="item.prop" :label="item.label">
      <el-select
        v-if="item.type === 'select'"
        v-model="queryParams[item.prop]"
        :placeholder="item.placeholder || '全部'"
        clearable
        :style="{ width: item.width || '160px' }"
        @change="emitSearch"
      >
        <el-option
          v-for="option in item.options || []"
          :key="String(option.value)"
          :label="option.label"
          :value="option.value"
        />
      </el-select>

      <el-date-picker
        v-else-if="item.type === 'date-range'"
        v-model="dateRanges[item.prop]"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        :style="{ width: item.width || '240px' }"
        @change="(value) => onDateChange(item.prop, value)"
      />

      <el-input
        v-else
        v-model="queryParams[item.prop]"
        :placeholder="item.placeholder || `请输入${item.label}`"
        clearable
        :style="{ width: item.width || '180px' }"
        @keyup.enter="emitSearch"
        @clear="emitSearch"
      />
    </el-form-item>

    <el-form-item>
      <el-button type="primary" icon="Search" @click="emitSearch">查询</el-button>
      <el-button icon="Refresh" @click="reset">重置</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup>
import { reactive, watch } from 'vue';

const props = defineProps({
  items: { type: Array, default: () => [] },
  queryParams: { type: Object, required: true },
});

const emit = defineEmits(['search', 'reset']);
const dateRanges = reactive({});

function emitSearch() {
  emit('search');
}

function onDateChange(prop, value) {
  if (Array.isArray(value) && value.length === 2) {
    props.queryParams[prop] = `${value[0]} 00:00:00,${value[1]} 23:59:59|between`;
  } else {
    props.queryParams[prop] = '';
  }
  emitSearch();
}

function reset() {
  props.items.forEach((item) => {
    props.queryParams[item.prop] = '';
    dateRanges[item.prop] = null;
  });
  emit('reset');
}

watch(
  () => props.items,
  (items) => {
    items.forEach((item) => {
      if (item.type === 'date-range') dateRanges[item.prop] = null;
    });
  },
  { immediate: true, deep: true }
);
</script>

<style scoped>
.search-form {
  padding: 12px 12px 0;
  margin-bottom: 8px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
}

:deep(.el-form-item) {
  margin-bottom: 12px;
}
</style>

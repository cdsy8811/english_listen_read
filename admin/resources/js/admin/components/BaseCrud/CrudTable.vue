<template>
  <div>
    <el-table
      v-loading="loading"
      :data="data"
      :row-key="rowKey"
      stripe
      border
      empty-text="暂无数据"
      @selection-change="(rows) => emit('selection-change', rows)"
      @sort-change="(payload) => emit('sort-change', payload)"
    >
      <el-table-column v-if="selection" type="selection" width="46" reserve-selection />

      <el-table-column
        v-for="col in columns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth || 110"
        :align="col.align || 'left'"
        :sortable="col.sortable ? 'custom' : false"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <slot :name="`column-${col.prop}`" :row="row" :value="row[col.prop]">
            <template v-if="col.type === 'tag'">
              <el-tag :type="tagType(col, row[col.prop])" size="small" effect="plain">
                {{ tagLabel(col, row[col.prop]) }}
              </el-tag>
            </template>
            <template v-else-if="col.type === 'switch'">
              <el-switch
                :model-value="Number(row[col.prop]) === 1"
                @change="(value) => emit('switch-change', { row, prop: col.prop, value: value ? 1 : 0 })"
              />
            </template>
            <template v-else-if="col.type === 'datetime'">
              {{ row[col.prop] || '-' }}
            </template>
            <template v-else-if="col.formatter">
              {{ col.formatter(row) }}
            </template>
            <template v-else>
              {{ display(col, row[col.prop]) }}
            </template>
          </slot>
        </template>
      </el-table-column>

      <el-table-column v-if="hasActions" label="操作" :width="actionWidth || 170" fixed="right" align="right">
        <template #default="{ row }">
          <el-button
            v-if="permissions?.edit && can('edit')"
            link
            type="primary"
            icon="Edit"
            @click="emit('edit', row)"
          >
            编辑
          </el-button>
          <el-button
            v-if="permissions?.remove && can('remove')"
            link
            type="danger"
            icon="Delete"
            @click="emit('delete', row)"
          >
            删除
          </el-button>
          <slot name="actions" :row="row" />
        </template>
      </el-table-column>
    </el-table>

    <div v-if="pagination" class="pager">
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="(value) => emit('page-change', value)"
        @size-change="(value) => emit('size-change', value)"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, useSlots } from 'vue';
import { hasPermission } from '@admin/utils/permission';

const props = defineProps({
  data: { type: Array, default: () => [] },
  columns: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 },
  loading: { type: Boolean, default: false },
  selection: { type: Boolean, default: true },
  rowKey: { type: String, default: 'id' },
  pagination: { type: Boolean, default: true },
  permissions: { type: Object, default: () => ({}) },
  actionWidth: { type: [Number, String], default: 0 },
});

const emit = defineEmits(['refresh', 'edit', 'delete', 'selection-change', 'page-change', 'size-change', 'switch-change', 'sort-change']);

const slots = useSlots();
const hasActions = computed(() => Boolean(props.permissions?.edit || props.permissions?.remove || slots.actions));

function can(action) {
  const code = props.permissions?.[action];
  return !code || hasPermission(code);
}

function display(col, value) {
  if (col.dict && col.dict[value] !== undefined) {
    return typeof col.dict[value] === 'object' ? col.dict[value].label : col.dict[value];
  }
  return value === null || value === undefined || value === '' ? '-' : value;
}

function tagLabel(col, value) {
  const item = col.dict?.[value];
  if (item && typeof item === 'object') return item.label;
  if (item !== undefined) return item;
  return value ?? '-';
}

function tagType(col, value) {
  const item = col.dict?.[value];
  if (item && typeof item === 'object' && item.type) return item.type;
  return col.tagType || 'info';
}
</script>

<style scoped>
.pager {
  display: flex;
  justify-content: flex-end;
  padding: 14px 0 2px;
}
</style>

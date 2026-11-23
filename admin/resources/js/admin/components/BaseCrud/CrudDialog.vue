<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    :width="width"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="(value) => emit('update:modelValue', value)"
  >
    <el-form ref="formRef" :model="model" :rules="rules" :label-width="labelWidth" v-loading="loading">
      <el-row :gutter="gutter">
        <el-col v-for="item in items" :key="item.prop" :span="item.span || 24">
          <el-form-item :label="item.label" :prop="item.prop">
            <slot :name="`field-${item.prop}`" :model="model" :item="item">
              <el-select
                v-if="item.type === 'select'"
                v-model="model[item.prop]"
                :multiple="item.multiple"
                :placeholder="item.placeholder || `请选择${item.label}`"
                clearable
                style="width: 100%"
              >
                <el-option
                  v-for="option in item.options || []"
                  :key="String(option.value)"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>

              <el-input-number
                v-else-if="item.type === 'number'"
                v-model="model[item.prop]"
                :min="item.min ?? 0"
                :max="item.max ?? 999999"
                style="width: 100%"
              />

              <el-switch
                v-else-if="item.type === 'switch'"
                v-model="model[item.prop]"
                :active-value="1"
                :inactive-value="0"
              />

              <el-input
                v-else-if="item.type === 'textarea'"
                v-model="model[item.prop]"
                type="textarea"
                :rows="item.rows || 4"
                :placeholder="item.placeholder || `请输入${item.label}`"
              />

              <el-input
                v-else
                v-model="model[item.prop]"
                :type="item.type === 'password' ? 'password' : 'text'"
                :show-password="item.type === 'password'"
                :placeholder="item.placeholder || `请输入${item.label}`"
                clearable
              />
            </slot>
            <div v-if="item.hint" class="field-hint">{{ item.hint }}</div>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <template #footer>
      <slot name="footer" :submit="submit">
        <el-button @click="emit('update:modelValue', false)">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="submit">保存</el-button>
      </slot>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '编辑' },
  width: { type: String, default: '640px' },
  labelWidth: { type: String, default: '110px' },
  gutter: { type: Number, default: 20 },
  items: { type: Array, default: () => [] },
  rules: { type: Object, default: () => ({}) },
  initialData: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
  submitLoading: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'submit']);
const formRef = ref();
const model = reactive({});

function buildModel() {
  Object.keys(model).forEach((key) => delete model[key]);

  props.items.forEach((item) => {
    const value = props.initialData?.[item.prop];
    if (value !== undefined && value !== null) {
      model[item.prop] = value;
    } else if (item.type === 'select' && item.multiple) {
      model[item.prop] = [];
    } else if (item.type === 'switch') {
      model[item.prop] = item.default ?? 0;
    } else if (item.type === 'number') {
      model[item.prop] = item.default ?? 0;
    } else {
      model[item.prop] = item.default ?? '';
    }
  });
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      buildModel();
      formRef.value?.clearValidate?.();
    }
  }
);

watch(() => props.initialData, () => {
  if (props.modelValue) buildModel();
}, { deep: true });

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  emit('submit', { ...model });
}

defineExpose({ validate: () => formRef.value?.validate(), model });
</script>

<style scoped>
.field-hint {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}
</style>

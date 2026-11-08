<template>
  <view>
    <input class="input" :value="modelValue" :disabled="disabled" :placeholder="placeholder"
      :focus="!disabled" confirm-type="done" @input="onInput" @confirm="$emit('submit')" />
    <view class="row" style="margin-top: 16rpx">
      <text class="sub">无网时输入框作答始终可用</text>
      <button class="btn btn-sm" :disabled="disabled || !modelValue.trim()" @click="$emit('submit')">提交</button>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{ modelValue: string; disabled?: boolean; placeholder?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'submit'): void
}>()
// uni-app 的 input 事件是 { detail: { value } }，与 DOM InputEvent 不同，这里用 any 承接
function onInput(e: any) { emit('update:modelValue', e.detail.value as string) }
</script>

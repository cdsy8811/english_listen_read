<template>
  <view>
    <!-- 不绑 focus：题目播放完也不主动抢焦点，否则安卓会直接弹出输入法，
         而且这种「无手势的程序化聚焦」常常拿不到输入法连接，打字进不了框。
         想作答就自己点一下输入框。提交按钮在作答面板里（见 practice.vue）。 -->
    <input class="input" :value="modelValue" :disabled="disabled" :placeholder="placeholder"
      confirm-type="done" @input="onInput" @focus="onFocus" @blur="onBlur" @confirm="$emit('submit')" />
    <text class="sub hint">无网时也能打字作答</text>
  </view>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { logger } from '@/utils/log'

const props = defineProps<{ modelValue: string; disabled?: boolean; placeholder?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'submit'): void
}>()

// 离开「请作答」状态（播放中 / 评价中 / 进入下一条）时主动收起输入法，
// 避免键盘在播报时挡住题目、或者带着上一条的焦点串到下一条
watch(() => props.disabled, (d) => {
  if (!d) return
  logger.debug('input.blur', { reason: 'disabled' })
  uni.hideKeyboard()
})

function onFocus() { logger.debug('input.focus', { by: 'user' }) }
function onBlur() { logger.debug('input.blur', { reason: 'user' }) }

// uni-app 的 input 事件是 { detail: { value } }，与 DOM InputEvent 不同，这里用 any 承接
function onInput(e: any) { emit('update:modelValue', e.detail.value as string) }
</script>

<style scoped>
.hint { display: block; margin-top: 14rpx; }
</style>

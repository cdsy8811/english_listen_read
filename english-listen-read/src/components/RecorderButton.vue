<template>
  <view>
    <button class="btn" :disabled="disabled || busy" @click="onTap">
      {{ busy ? '正在处理…' : recording ? '点击结束录音' : '点击开始录音（≤60 秒）' }}
    </button>
    <view class="row" style="margin-top: 16rpx">
      <text class="sub">{{ recording ? '录音中，答完请点击结束' : '录音只用于转写文字，不评价发音' }}</text>
      <text class="sub" @click="$emit('fallback')">改用输入框 ›</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { startRecording, stopRecording, recordAvailable } from '@/services'
import { requestPermission } from '@/utils/permission'

defineProps<{ disabled?: boolean; busy?: boolean }>()
const emit = defineEmits<{
  (e: 'recorded', base64: string): void
  (e: 'fallback'): void
}>()

const recording = ref(false)
let startedAt = 0

async function onTap() {
  if (!recording.value) {
    if (!recordAvailable()) { emit('fallback'); return }
    if (!(await requestPermission('record'))) {
      uni.showToast({ title: '没有录音权限，已切换到输入框作答', icon: 'none' })
      emit('fallback')
      return
    }
    try {
      startRecording()
      startedAt = Date.now()
      recording.value = true
      // 超过 60s 自动收口，符合听写单次音频上限
      setTimeout(() => { if (recording.value) void finish() }, 60000)
    } catch (_) {
      emit('fallback')
    }
    return
  }
  await finish()
}

async function finish() {
  if (!recording.value) return
  recording.value = false
  if (Date.now() - startedAt < 400) {
    uni.showToast({ title: '录音太短，请再说一遍', icon: 'none' })
    return
  }
  try {
    const r = await stopRecording()
    emit('recorded', r.base64)
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '录音失败', icon: 'none' })
    emit('fallback')
  }
}
</script>

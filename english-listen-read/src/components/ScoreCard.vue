<template>
  <view class="card result-card">
    <view class="row">
      <text class="title">内容正确度</text>
      <text class="score" :class="scoreClass">{{ result.score }} 分</text>
    </view>
    <text class="sub">{{ result.feedback }}{{ result.semantic ? '（已结合语义判分）' : '（本地文本比对）' }}</text>
    <view class="divider" />

    <text class="label">逐词对照（只表示文本对错）</text>
    <view class="hl-row">
      <view v-for="(h, i) in result.highlights" :key="i" class="hl" :class="h.ok ? 'ok' : 'bad'">{{ h.text }}</view>
      <text v-if="!result.highlights.length" class="sub">无</text>
    </view>

    <view class="divider" />
    <text class="label">{{ mode === '2.2' ? '标准英文' : '标准释义' }}</text>
    <text class="answer">{{ result.expected }}</text>
    <text class="label" style="margin-top: 16rpx">你的作答</text>
    <text class="answer">{{ result.answer || '（空）' }}</text>
    <text v-if="result.asrText && result.asrText !== result.answer" class="sub">录音转写：{{ result.asrText }}</text>

    <view class="row" style="margin-top: 28rpx; gap: 16rpx">
      <button class="btn btn-plain" style="flex: 1" @click="$emit('retry')">重试</button>
      <button class="btn" style="flex: 1" @click="$emit('next')">下一条</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EvalResult, PracticeMode } from '@/services/types'

const props = defineProps<{ result: EvalResult; mode: PracticeMode }>()
defineEmits<{ (e: 'retry'): void; (e: 'next'): void }>()
const scoreClass = computed(() => props.result.score >= 90 ? 'good' : props.result.score >= 60 ? 'mid' : 'low')
</script>

<style scoped>
.result-card { border: 2rpx solid var(--elr-line); }
.score { font-size: 44rpx; font-weight: 700; }
.score.good { color: var(--elr-ok); }
.score.mid { color: var(--elr-warn); }
.score.low { color: var(--elr-err); }
.label { display: block; font-size: 26rpx; color: var(--elr-muted); margin-bottom: 10rpx; }
.answer { display: block; font-size: 30rpx; }
.hl-row { display: flex; flex-wrap: wrap; gap: 12rpx; }
.hl { padding: 8rpx 18rpx; border-radius: 10rpx; font-size: 26rpx; }
.hl.ok { background: #e8f7ee; color: var(--elr-ok); }
.hl.bad { background: #fdeceb; color: var(--elr-err); }
</style>

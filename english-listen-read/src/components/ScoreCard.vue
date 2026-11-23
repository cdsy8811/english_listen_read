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
    <view class="answer-head">
      <text class="label">{{ mode === '2.2' ? '标准英文' : '标准释义' }}</text>
      <text class="play" :class="{ on: playing === 'word' }" @click="$emit('playWord')">
        {{ playing === 'word' ? '■ 停止' : '▶ 播放' }}
      </text>
    </view>
    <text class="answer">{{ result.expected }}</text>

    <view class="answer-head" style="margin-top: 16rpx">
      <text class="label">你的作答</text>
      <text v-if="recordPath" class="play" :class="{ on: playing === 'mine' }" @click="$emit('playMine')">
        {{ playing === 'mine' ? '■ 停止' : '▶ 播放录音' }}
      </text>
    </view>
    <text class="answer">{{ result.answer || '（空）' }}</text>
    <text v-if="result.asrText && result.asrText !== result.answer" class="sub">录音转写：{{ result.asrText }}</text>
    <text v-if="canTypeInstead" class="link" @click="$emit('type')">识别不对？改为手动输入</text>

    <view class="row" style="margin-top: 28rpx; gap: 16rpx">
      <button class="btn btn-plain" style="flex: 1" @click="$emit('retry')">重试</button>
      <button class="btn" style="flex: 1" @click="$emit('next')">下一条</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EvalResult, PracticeMode } from '@/services/types'

const props = defineProps<{
  result: EvalResult
  mode: PracticeMode
  /** 本次录音的本地文件（没有录音就没有「播录音」） */
  recordPath?: string
  /** 正在回放的片段，用于把按钮切成「停止」 */
  playing?: '' | 'word' | 'mine'
  /** 是否允许「改为手动输入」：2.2 只保留语音作答，传 false 隐藏该入口 */
  allowRetext?: boolean
}>()
defineEmits<{
  (e: 'retry'): void
  (e: 'next'): void
  (e: 'type'): void
  (e: 'playWord'): void
  (e: 'playMine'): void
}>()
const scoreClass = computed(() => props.result.score >= 90 ? 'good' : props.result.score >= 60 ? 'mid' : 'low')
/** 录音作答且没拿满分时，给一条不用重录、直接改文字的路（听写同音歧义常见）；2.2 只保留语音，不提供 */
const canTypeInstead = computed(() =>
  props.allowRetext !== false && !!props.result.asrText && props.result.score < 100,
)
</script>

<style scoped>
.result-card { border: 2rpx solid var(--elr-line); }
.score { font-size: 44rpx; font-weight: 700; }
.score.good { color: var(--elr-ok); }
.score.mid { color: var(--elr-warn); }
.score.low { color: var(--elr-err); }
.label { display: block; font-size: 26rpx; color: var(--elr-muted); margin-bottom: 10rpx; }
.answer-head { display: flex; align-items: center; justify-content: space-between; }
.play { font-size: 24rpx; color: var(--elr-primary-dark); padding: 4rpx 0 4rpx 18rpx; }
.play.on { color: var(--elr-err); }
.link { display: block; font-size: 25rpx; color: var(--elr-primary-dark); margin-top: 14rpx; }
.answer { display: block; font-size: 30rpx; }
.hl-row { display: flex; flex-wrap: wrap; gap: 12rpx; }
.hl { padding: 8rpx 18rpx; border-radius: 10rpx; font-size: 26rpx; }
.hl.ok { background: #e8f7ee; color: var(--elr-ok); }
.hl.bad { background: #fdeceb; color: var(--elr-err); }
</style>

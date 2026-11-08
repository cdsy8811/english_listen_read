<template>
  <view class="page">
    <view class="card">
      <text class="title">选择练习模式</text>
      <view class="divider" />
      <text class="sub">当前单元：{{ unitTitle }}（{{ words.length }} 条）</text>
    </view>

    <view class="card mode-card" @click="start('2.1')">
      <view class="row">
        <text class="title">2.1 中英共读</text>
        <text class="tag">无需作答</text>
      </view>
      <text class="sub">系统依次朗读英文与中文释义，按设定间隔自动进入下一条。适合先熟悉词表。</text>
      <view class="row" style="margin-top: 20rpx">
        <text class="sub">顺序 {{ orderLabel }} · 重复 {{ settings.data.repeatTimes }} 次 · 间隔 {{ settings.data.itemGapSec }}s</text>
        <text class="go">开始 ›</text>
      </view>
    </view>

    <view class="card mode-card" @click="start('2.2')">
      <view class="row">
        <text class="title">2.2 看中说英</text>
        <text class="tag">内容正确度</text>
      </view>
      <text class="sub">读中文释义，用录音或输入框说出 / 写出英文，系统评价内容是否答对（不做发音评分）。</text>
      <view class="row" style="margin-top: 20rpx">
        <text class="sub">作答方式 {{ settings.data.answerType === 'record' ? '录音' : '输入框' }}</text>
        <text class="go">开始 ›</text>
      </view>
    </view>

    <view class="card mode-card" @click="start('2.3')">
      <view class="row">
        <text class="title">2.3 看英说中</text>
        <text class="tag">中文释义</text>
      </view>
      <text class="sub">读英文单词，用录音或输入框给出中文释义，按关键词覆盖与语义判断给分，同义表述也算对。</text>
      <view class="row" style="margin-top: 20rpx">
        <text class="sub">作答方式 {{ settings.data.answerType === 'record' ? '录音' : '输入框' }}</text>
        <text class="go">开始 ›</text>
      </view>
    </view>

    <view class="card">
      <text class="sub">只有三种模式（原文「2.4」为笔误）。2.2 只评价内容正确度，不接 ISE、不给发音分。</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/store/settings'
import { listWords, getUnit } from '@/services/storage'
import type { PracticeMode, Word } from '@/services/types'

const settings = useSettingsStore()
const unitId = ref('')
const unitTitle = ref('')
const words = ref<Word[]>([])
const orderLabel = computed(() => ({ 'en-zh': '英→中', 'zh-en': '中→英', 'en-only': '仅英' })[settings.data.playOrder])

onLoad(async (q) => {
  await settings.load()
  unitId.value = q?.unitId || ''
  if (!unitId.value) return
  const u = await getUnit(unitId.value)
  unitTitle.value = u?.title || '未命名单元'
  words.value = await listWords(unitId.value)
})

function start(mode: PracticeMode) {
  if (!words.value.length) {
    uni.showToast({ title: '本单元还没有词条', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/practice/practice?unitId=${unitId.value}&mode=${mode}` })
}
</script>

<style scoped>
.mode-card:active { opacity: .8; }
.go { color: var(--elr-primary); font-size: 28rpx; }
</style>

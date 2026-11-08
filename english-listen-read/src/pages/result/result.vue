<template>
  <view class="page">
    <view class="card">
      <text class="title">本轮完成</text>
      <view class="divider" />
      <view class="row">
        <view class="stat"><text class="num">{{ practice.total }}</text><text class="sub">词条</text></view>
        <view class="stat"><text class="num">{{ practice.answered }}</text><text class="sub">已作答</text></view>
        <view class="stat"><text class="num">{{ practice.average }}</text><text class="sub">平均内容正确度</text></view>
        <view class="stat"><text class="num">{{ practice.wrongCount }}</text><text class="sub">需复习</text></view>
      </view>
      <text class="sub" style="display: block; margin-top: 20rpx">评价只反映文字内容是否答对，不含发音评分。</text>
    </view>

    <view class="card" v-for="(r, i) in practice.rounds" :key="i">
      <view class="row">
        <text class="title">{{ r.word }}</text>
        <text class="score" :class="r.score >= 90 ? 'good' : r.score >= 60 ? 'mid' : 'low'">{{ r.score }} 分</text>
      </view>
      <text v-if="r.result" class="sub">标准答案：{{ r.result.expected }} · 你的作答：{{ r.result.answer || '（空）' }}</text>
      <text v-else class="sub">已跳过</text>
    </view>

    <view class="card">
      <button class="btn" @click="onAgain">再练一轮</button>
      <button class="btn btn-plain" style="margin-top: 20rpx" @click="onWrongbook">查看错词本</button>
      <button class="btn btn-plain" style="margin-top: 20rpx" @click="onHome">返回词库首页</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { usePracticeStore } from '@/store/practice'

const practice = usePracticeStore()

function onAgain() {
  uni.redirectTo({ url: `/pages/practice/practice?unitId=${practice.unitId}&mode=${practice.mode}` })
}
function onWrongbook() { uni.navigateTo({ url: '/pages/wrongbook/wrongbook' }) }
function onHome() { uni.switchTab({ url: '/pages/index/index' }) }
</script>

<style scoped>
.stat { display: flex; flex-direction: column; align-items: center; flex: 1; }
.num { font-size: 40rpx; font-weight: 700; }
.score { font-size: 32rpx; font-weight: 600; }
.score.good { color: var(--elr-ok); }
.score.mid { color: var(--elr-warn); }
.score.low { color: var(--elr-err); }
</style>

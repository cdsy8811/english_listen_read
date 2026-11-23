<template>
  <view class="page">
    <view class="result-hero">
      <view class="glow" />
      <view class="ring">
        <text class="ring-num">{{ practice.answered ? practice.average : '—' }}</text>
        <text class="ring-label">平均内容正确度</text>
      </view>
      <text class="hero-title">本轮完成</text>
      <text class="hero-sub">{{ practice.total }} 个词条 · 已作答 {{ practice.answered }} · 需复习 {{ practice.wrongCount }}</text>
      <text class="hero-note">评价只反映文字内容是否答对，不含发音评分</text>
    </view>

    <view class="stats-card">
      <view class="stat">
        <text class="stat-num">{{ practice.total }}</text>
        <text class="stat-label">词条</text>
      </view>
      <view class="stat-line" />
      <view class="stat">
        <text class="stat-num">{{ practice.answered }}</text>
        <text class="stat-label">已作答</text>
      </view>
      <view class="stat-line" />
      <view class="stat">
        <text class="stat-num">{{ practice.wrongCount }}</text>
        <text class="stat-label">需复习</text>
      </view>
    </view>

    <view class="section-head">
      <text class="section-title">本轮作答</text>
      <text class="section-more">{{ practice.rounds.length }} 条</text>
    </view>

    <view v-if="practice.rounds.length" class="card rounds-card">
      <view class="round" v-for="(r, i) in practice.rounds" :key="i">
        <view class="round-main">
          <text class="round-word">{{ r.word }}</text>
          <text class="round-detail" v-if="r.result">标准答案：{{ r.result.expected }} · 你的作答：{{ r.result.answer || '（空）' }}</text>
          <text class="round-detail" v-else>已跳过</text>
        </view>
        <text class="score" :class="r.score >= 90 ? 'good' : r.score >= 60 ? 'mid' : 'low'">{{ r.score }}</text>
      </view>
    </view>
    <view v-else class="card empty">本轮没有作答记录</view>

    <view class="actions">
      <button class="btn" @click="onAgain">再练一轮</button>
      <button class="btn btn-ghost" style="margin-top: 18rpx" @click="onWrongbook">查看错词本</button>
      <button class="btn btn-plain" style="margin-top: 18rpx" @click="onHome">返回首页</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { usePracticeStore } from '@/store/practice'

const practice = usePracticeStore()
/** 默写（2.2 的只打字变体）：「再练一轮」要保持默写，不要退回带朗读的 2.2 */
const dictation = ref(false)
onLoad((q) => { dictation.value = q?.input === 'type' })

function onAgain() {
  const extra = dictation.value ? '&input=type' : ''
  uni.redirectTo({ url: `/pages/practice/practice?unitId=${practice.unitId}&mode=${practice.mode}${extra}` })
}
function onWrongbook() { uni.navigateTo({ url: '/pages/wrongbook/wrongbook' }) }
function onHome() { uni.switchTab({ url: '/pages/index/index' }) }
</script>

<style scoped>
.result-hero {
  position: relative; overflow: hidden;
  background: linear-gradient(140deg, #fb923c 0%, #f97316 60%, #ea580c 100%);
  border-radius: 34rpx; padding: 40rpx 34rpx 32rpx; color: #fff; text-align: center;
  box-shadow: 0 18rpx 44rpx rgba(249, 115, 22, .26);
}
.glow { position: absolute; width: 280rpx; height: 280rpx; border-radius: 50%; right: -90rpx; top: -120rpx; background: rgba(255, 255, 255, .13); }
.ring {
  position: relative; width: 200rpx; height: 200rpx; border-radius: 50%;
  margin: 0 auto 24rpx; background: rgba(255, 255, 255, .14);
  border: 4rpx solid rgba(255, 255, 255, .35);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.ring-num { font-size: 62rpx; font-weight: 700; line-height: 1.1; }
.ring-label { font-size: 20rpx; color: rgba(255, 255, 255, .75); margin-top: 4rpx; }
.hero-title { display: block; font-size: 36rpx; font-weight: 700; }
.hero-sub { display: block; font-size: 23rpx; color: rgba(255, 255, 255, .8); margin-top: 10rpx; }
.hero-note { display: block; font-size: 20rpx; color: rgba(255, 255, 255, .6); margin-top: 14rpx; }

.stats-card {
  display: flex; align-items: center; background: #fff;
  border-radius: 28rpx; padding: 26rpx 0; margin: 24rpx 0;
  box-shadow: 0 8rpx 26rpx rgba(27, 33, 48, .05);
}
.stat { flex: 1; display: flex; flex-direction: column; align-items: center; }
.stat-num { font-size: 38rpx; font-weight: 700; }
.stat-label { font-size: 21rpx; color: var(--elr-muted); margin-top: 4rpx; }
.stat-line { width: 1rpx; height: 44rpx; background: var(--elr-line); }

.rounds-card { padding: 6rpx 28rpx; }
.round { display: flex; align-items: center; gap: 20rpx; padding: 24rpx 0; border-bottom: 1rpx solid var(--elr-line); }
.round:last-child { border-bottom: none; }
.round-main { flex: 1; min-width: 0; }
.round-word { display: block; font-size: 30rpx; font-weight: 600; }
.round-detail { display: block; font-size: 22rpx; color: var(--elr-muted); margin-top: 6rpx; }
.score { font-size: 34rpx; font-weight: 700; }
.score.good { color: var(--elr-ok); }
.score.mid { color: var(--elr-warn); }
.score.low { color: var(--elr-err); }
.actions { margin-top: 26rpx; }
</style>

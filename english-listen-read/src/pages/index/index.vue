<template>
  <view class="page">
    <!-- 顶部学习概览 -->
    <view class="hero">
      <view class="glow glow-a" />
      <view class="glow glow-b" />
      <view class="hero-top">
        <view class="hero-copy">
          <text class="hero-kicker">TODAY · 保持练习</text>
          <text class="hero-title">橙子英语</text>
          <text class="hero-sub">把单词表变成你的听说练习</text>
        </view>
        <image class="hero-mark" src="/static/brand/mark.png" mode="aspectFit" />
      </view>
      <view class="stats">
        <view class="stat">
          <text class="stat-num">{{ library.units.length }}</text>
          <text class="stat-label">学习单元</text>
        </view>
        <view class="stat-line" />
        <view class="stat">
          <text class="stat-num">{{ totalWords }}</text>
          <text class="stat-label">词条</text>
        </view>
        <view class="stat-line" />
        <view class="stat">
          <text class="stat-num">{{ wrongCount }}</text>
          <text class="stat-label">待复习</text>
        </view>
      </view>
    </view>

    <!-- 快捷入口：一行四个，只保留图标与名称 -->
    <view class="quick">
      <view class="quick-item" @click="onCapture">
        <view class="quick-icon icon-brand">拍</view>
        <text class="quick-title">拍照入库</text>
      </view>
      <view class="quick-item" @click="goWrongbook">
        <view class="quick-icon icon-rose">错</view>
        <text class="quick-title">错词本</text>
      </view>
      <view class="quick-item" @click="goDict">
        <view class="quick-icon icon-violet">词</view>
        <text class="quick-title">电子词典</text>
      </view>
      <view class="quick-item" @click="goLibrary">
        <view class="quick-icon icon-green">库</view>
        <text class="quick-title">词库管理</text>
      </view>
    </view>

    <!-- 跟读快捷入口 -->
    <view class="read-banner" @click="goRead">
      <view class="read-banner-icon">▶</view>
      <view class="read-banner-main">
        <text class="read-banner-title">短文跟读</text>
        <text class="read-banner-sub">手工添加 · 整段听 · 点词听 · 逐句检查</text>
      </view>
      <text class="read-banner-go">开始 ›</text>
    </view>

    <!-- 学习单元 -->
    <view class="section-head">
      <text class="section-title">我的单元</text>
      <text class="section-more link" :class="{ active: multi }" @click="toggleMulti">
        {{ multi ? '取消多选' : '多选模式' }}
      </text>
    </view>

    <view v-if="multi && library.units.length" class="multi-tip">
      勾选多个单元，合并后一起练习测试
    </view>

    <view v-if="library.units.length" class="unit-list">
      <view
        v-for="(u, i) in library.units" :key="u.id"
        class="unit-card"
        :class="{ picked: multi && isPicked(u.id) }"
        @click="onUnitTap(u.id)"
      >
        <view class="unit-cover" :style="{ background: cover(i) }">{{ badge(i) }}</view>
        <view class="unit-main">
          <text class="unit-title">{{ u.title }}</text>
          <text class="unit-sub">{{ countOf(u.id) }} 个词条 · 四种练习</text>
        </view>
        <view v-if="multi" class="pick" :class="{ on: isPicked(u.id) }">
          <text class="pick-mark">{{ isPicked(u.id) ? '✓' : '' }}</text>
        </view>
        <view v-else class="unit-arrow">›</view>
      </view>
    </view>

    <view v-else class="card empty-card">
      <view class="empty-mark">Aa</view>
      <text class="empty-title">还没有学习单元</text>
      <text class="sub">拍下书上的单词表，或先载入初一词汇体验</text>
      <button class="btn empty-btn" @click="onCapture">拍照创建单元</button>
      <button class="btn btn-plain empty-btn" @click="onSeed">载入初一词汇</button>
    </view>

    <view class="footer-note">离线可用 · 数据只保存在本机</view>

    <view v-if="multi" class="multi-bar-space" />
    <view v-if="multi" class="multi-bar">
      <view class="multi-info">
        <text class="multi-count">已选 {{ selected.length }} 个单元</text>
        <text class="multi-sub">共 {{ selectedWords }} 个词条</text>
      </view>
      <button class="btn multi-btn" :disabled="!selected.length" @click="startMulti">开始练习</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { useLibraryStore } from '@/store/library'
import { listWords, listWrongWords } from '@/services/storage'
import { seedBuiltinVocab, SEED_UNITS, SEED_WORDS } from '@/services/seed'
import { ensurePrivacyNotice } from '@/utils/privacy'

const library = useLibraryStore()
const counts = ref<Record<string, number>>({})
const wrongCount = ref(0)
const multi = ref(false)
const selected = ref<string[]>([])

const totalWords = computed(() =>
  library.units.reduce((sum, u) => sum + (counts.value[u.id] || 0), 0),
)

const selectedWords = computed(() =>
  selected.value.reduce((sum, id) => sum + (counts.value[id] || 0), 0),
)

const COVERS = [
  'linear-gradient(135deg, #fdba74, #f97316)',
  'linear-gradient(135deg, #34d399, #10b981)',
  'linear-gradient(135deg, #fbbf24, #f59e0b)',
  'linear-gradient(135deg, #f472b6, #ec4899)',
  'linear-gradient(135deg, #38bdf8, #0ea5e9)',
  'linear-gradient(135deg, #a78bfa, #8b5cf6)',
]

function cover(i: number) { return COVERS[i % COVERS.length] }
function countOf(id: string) { return counts.value[id] || 0 }

function badge(i: number) { return String(i + 1).padStart(2, '0') }

async function refresh() {
  await library.refreshUnits()
  const entries = await Promise.all(
    library.units.map(async (u) => [u.id, (await listWords(u.id)).length] as const),
  )
  counts.value = Object.fromEntries(entries)
  wrongCount.value = (await listWrongWords()).length
}

onShow(async () => {
  void ensurePrivacyNotice()
  await refresh()
})

onPullDownRefresh(async () => {
  await refresh()
  uni.stopPullDownRefresh()
})

function openUnit(id: string) {
  uni.navigateTo({ url: `/pages/mode/mode?unitId=${id}` })
}

function toggleMulti() {
  multi.value = !multi.value
  if (!multi.value) selected.value = []
}

function isPicked(id: string) { return selected.value.includes(id) }

function onUnitTap(id: string) {
  if (!multi.value) { openUnit(id); return }
  selected.value = isPicked(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
}

function startMulti() {
  if (!selected.value.length) {
    uni.showToast({ title: '请先选择至少一个单元', icon: 'none' })
    return
  }
  const ids = library.units.filter((u) => selected.value.includes(u.id)).map((u) => u.id)
  uni.navigateTo({ url: `/pages/mode/mode?unitIds=${ids.join(',')}` })
}
function onCapture() { uni.navigateTo({ url: '/pages/capture/capture' }) }
function goWrongbook() { uni.navigateTo({ url: '/pages/wrongbook/wrongbook' }) }
function goDict() { uni.navigateTo({ url: '/pages/dict/dict' }) }
function goRead() { uni.switchTab({ url: '/pages/read/read' }) }
function goLibrary() { uni.switchTab({ url: '/pages/library/library' }) }

function onSeed() {
  uni.showModal({
    title: '载入初一词汇',
    content: `将写入 ${SEED_UNITS} 个学习单元、${SEED_WORDS} 个词条（人教版七年级教材词汇表）。同 id 覆盖，重复载入不会建重复单元。`,
    confirmText: '载入',
    success: async (r) => {
      if (!r.confirm) return
      try {
        const out = await seedBuiltinVocab()
        await refresh()
        uni.showToast({ title: `已载入 ${out.units} 单元 / ${out.words} 词`, icon: 'success' })
      } catch (e) {
        uni.showToast({ title: (e as Error).message || '载入失败', icon: 'none' })
      }
    },
  })
}
</script>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  background: linear-gradient(140deg, #fb923c 0%, #f97316 55%, #ea580c 100%);
  border-radius: 36rpx;
  padding: 38rpx 34rpx 30rpx;
  color: #fff;
  box-shadow: 0 18rpx 44rpx rgba(249, 115, 22, .28);
}
.glow { position: absolute; border-radius: 50%; background: rgba(255, 255, 255, .14); }
.glow-a { width: 300rpx; height: 300rpx; right: -90rpx; top: -120rpx; }
.glow-b { width: 180rpx; height: 180rpx; left: -70rpx; bottom: -90rpx; background: rgba(255, 255, 255, .09); }
.hero-top { position: relative; display: flex; justify-content: space-between; align-items: flex-start; }
.hero-copy { display: flex; flex-direction: column; }
.hero-kicker { font-size: 20rpx; letter-spacing: 3rpx; color: rgba(255, 255, 255, .72); }
.hero-title { font-size: 46rpx; font-weight: 700; margin-top: 8rpx; letter-spacing: 1rpx; }
.hero-sub { font-size: 24rpx; color: rgba(255, 255, 255, .78); margin-top: 8rpx; }
.hero-mark {
  width: 104rpx; height: 104rpx; flex-shrink: 0;
}
.stats { position: relative; display: flex; align-items: center; margin-top: 34rpx; }
.stat { flex: 1; display: flex; flex-direction: column; align-items: center; }
.stat-num { font-size: 40rpx; font-weight: 700; line-height: 1.2; }
.stat-label { font-size: 22rpx; color: rgba(255, 255, 255, .74); margin-top: 4rpx; }
.stat-line { width: 1rpx; height: 48rpx; background: rgba(255, 255, 255, .25); }

.quick { display: flex; flex-wrap: nowrap; gap: 14rpx; margin: 24rpx 0 8rpx; }
.quick-item {
  flex: 1; min-width: 0; background: #fff; border-radius: 26rpx; padding: 22rpx 6rpx 20rpx;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 8rpx 24rpx rgba(27, 33, 48, .05);
}
.quick-item:active { opacity: .85; }
.quick-icon {
  width: 68rpx; height: 68rpx; border-radius: 22rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 28rpx; font-weight: 600; color: #fff;
}
.icon-brand { background: linear-gradient(135deg, #fdba74, #f97316); }
.icon-rose { background: linear-gradient(135deg, #fb7185, #f43f5e); }
.icon-green { background: linear-gradient(135deg, #34d399, #10b981); }
.icon-violet { background: linear-gradient(135deg, #a78bfa, #7c5cf0); }
.quick-title { font-size: 24rpx; font-weight: 600; margin-top: 12rpx; white-space: nowrap; }

.read-banner {
  display: flex; align-items: center; gap: 20rpx;
  background: linear-gradient(135deg, #fff1e3, #ffe6cd);
  border: 2rpx solid #ffe0c2;
  border-radius: 26rpx; padding: 22rpx 24rpx; margin-top: 18rpx;
}
.read-banner:active { opacity: .85; }
.read-banner-icon {
  width: 76rpx; height: 76rpx; border-radius: 22rpx; flex-shrink: 0;
  background: var(--elr-primary); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 28rpx; font-weight: 700; line-height: 1;
}
.read-banner-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.read-banner-title { font-size: 28rpx; font-weight: 600; }
.read-banner-sub { font-size: 21rpx; color: #6a7287; margin-top: 4rpx; }
.read-banner-go { flex-shrink: 0; font-size: 24rpx; color: var(--elr-primary-dark); font-weight: 600; }

.section-more.link {
  color: var(--elr-primary-dark); background: #fff1e3;
  border-radius: 999rpx; padding: 6rpx 20rpx; font-size: 23rpx;
}
.section-more.link.active { color: #fff; background: var(--elr-primary); }
.multi-tip { font-size: 22rpx; color: var(--elr-muted); margin: -4rpx 0 16rpx 4rpx; }

.unit-list { display: flex; flex-direction: column; gap: 18rpx; }
.unit-card {
  display: flex; align-items: center; gap: 22rpx;
  background: #fff; border-radius: 28rpx; padding: 22rpx 26rpx;
  box-shadow: 0 8rpx 26rpx rgba(27, 33, 48, .05);
  border: 2rpx solid transparent; transition: border-color .2s, background .2s;
}
.unit-card:active { background: #fffdfb; }
.unit-card.picked { border-color: var(--elr-primary-dark); background: #fffaf5; }
.unit-cover {
  width: 94rpx; height: 94rpx; border-radius: 26rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 32rpx; font-weight: 700; letter-spacing: 1rpx;
}
.unit-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.unit-title { font-size: 32rpx; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unit-sub { font-size: 23rpx; color: var(--elr-muted); margin-top: 8rpx; }
.unit-arrow { color: #c3c9d8; font-size: 38rpx; }
.pick {
  width: 44rpx; height: 44rpx; border-radius: 50%; flex-shrink: 0;
  border: 2rpx solid #d3d9e6; background: #fff;
  display: flex; align-items: center; justify-content: center;
}
.pick.on { background: var(--elr-primary); border-color: var(--elr-primary-dark); }
.pick-mark { color: #fff; font-size: 24rpx; font-weight: 700; line-height: 1; }

.multi-bar-space { height: calc(140rpx + env(safe-area-inset-bottom)); }
.multi-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  display: flex; align-items: center; gap: 22rpx;
  padding: 18rpx 30rpx calc(18rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, .97);
  border-top-left-radius: 30rpx; border-top-right-radius: 30rpx;
  box-shadow: 0 -10rpx 34rpx rgba(27, 33, 48, .10);
}
.multi-info { flex: 1; display: flex; flex-direction: column; }
.multi-count { font-size: 27rpx; font-weight: 600; }
.multi-sub { font-size: 21rpx; color: var(--elr-muted); margin-top: 4rpx; }
.multi-btn {
  width: 260rpx; margin: 0; padding: 20rpx 0; font-size: 27rpx;
}
.multi-btn[disabled] { background: #ecd9c9; color: #fff; }

.empty-card { display: flex; flex-direction: column; align-items: center; padding: 56rpx 40rpx; }
.empty-mark {
  width: 120rpx; height: 120rpx; border-radius: 36rpx;
  background: linear-gradient(135deg, #fff1e3, #ffe0c2);
  color: var(--elr-primary-dark); font-size: 44rpx; font-weight: 700; font-style: italic;
  display: flex; align-items: center; justify-content: center;
}
.empty-title { font-size: 32rpx; font-weight: 600; margin: 24rpx 0 10rpx; }
.empty-btn { width: 100%; margin-top: 22rpx; }
.footer-note { text-align: center; font-size: 22rpx; color: #b3bacb; padding: 30rpx 0 10rpx; }
</style>

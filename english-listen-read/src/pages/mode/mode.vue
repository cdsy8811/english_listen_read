<template>
  <view class="page mode-page">
    <view class="unit-hero">
      <view class="glow" />
      <view class="hero-top">
        <text class="hero-label">学习单元</text>
        <view class="random-row">
          <text class="random-text">随机模式</text>
          <switch class="random-switch" :checked="randomMode" color="#34d399" @change="onRandomChange" />
        </view>
      </view>
      <text class="hero-title">{{ unitTitle || '未命名单元' }}</text>
      <view class="hero-meta-row">
        <view class="hero-meta">
          <text v-if="unitIds.length > 1" class="hero-chip">{{ unitIds.length }} 个单元</text>
          <text class="hero-chip">{{ words.length }} 个词条</text>
          <text v-if="selecting" class="hero-chip pick-chip">已选 {{ selected.length }} 个</text>
          <text v-else class="hero-chip">4 种练习方式</text>
        </view>
        <view class="pick-btn" :class="{ active: selecting }" @click="toggleSelect">
          <text class="pick-btn-text">{{ selecting ? '退出选择' : '选择模式' }}</text>
        </view>
      </view>
    </view>

    <view class="section-head">
      <text class="section-title">全部单词</text>
      <text class="section-more">{{ words.length }} 个</text>
    </view>

    <view v-if="words.length" class="card list-card" :class="{ 'picking': selecting }">
      <view
        class="word-item"
        :class="{ playing: playingId === w.id, selected: selecting && isSelected(w.id) }"
        v-for="(w, i) in words"
        :key="w.id"
        @click="onWordTap(w)"
      >
        <view v-if="selecting" class="pick-tick" :class="{ on: isSelected(w.id) }">
          <text v-if="isSelected(w.id)" class="pick-tick-icon">✓</text>
        </view>
        <text class="word-index">{{ i + 1 }}</text>
        <view class="word-main">
          <view class="word-line">
            <text class="word">{{ w.word }}</text>
            <text v-if="phoneticOf(w)" class="phonetic">{{ phoneticOf(w) }}</text>
            <text v-if="w.pos" class="pos">{{ w.pos }}</text>
          </view>
          <text class="trans">{{ w.translation || '（未填释义）' }}</text>
        </view>
        <view v-if="!selecting" class="play-btn" :class="{ active: playingId === w.id }" @click.stop="playWord(w)">
          <text class="play-icon">{{ playingId === w.id ? '■' : '▶' }}</text>
        </view>
      </view>
    </view>

    <view v-else class="card empty">
      本单元还没有词条，请先在「词库」中添加或拍照入库。
    </view>

    <view class="bar-space" :class="{ taller: selecting }" />

    <!-- 固定在底部的练习入口：学习 / 中英 / 英中 / 默写 -->
    <view class="mode-bar">
      <view v-if="selecting" class="pick-bar">
        <view class="pick-bar-info">
          <text class="pick-bar-count">已选 {{ selected.length }} 个</text>
          <text class="pick-bar-hint">点下方模式，只练所选单词</text>
        </view>
        <view class="pick-bar-actions">
          <text class="pick-action" @click="selectAll">{{ allSelected ? '取消全选' : '全选' }}</text>
          <text class="pick-action" @click="clearSelection">清空</text>
        </view>
      </view>
      <view class="mode-row">
        <view class="mode-item" v-for="m in modes" :key="m.name" @click="start(m)">
          <view class="mode-icon" :class="m.tone">{{ m.mark }}</view>
          <text class="mode-name">{{ m.name }}</text>
          <text class="mode-desc">{{ selecting ? '只练所选' : m.desc }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad, onUnload, onHide, onBackPress } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/store/settings'
import { listWords, getUnit } from '@/services/storage'
import { playQueue } from '@/services'
import { logger } from '@/utils/log'
import type { PracticeMode, Word } from '@/services/types'

const settings = useSettingsStore()
const unitId = ref('')
const unitIds = ref<string[]>([])
const unitTitle = ref('')
const words = ref<Word[]>([])
const playingId = ref('')
const selecting = ref(false)
/** 选择模式：已勾选的单词 id */
const selected = ref<string[]>([])
const randomMode = computed(() => settings.data.randomOrder)
let playToken = 0

const MODES: Array<{ id: PracticeMode; name: string; desc: string; mark: string; tone: string; input?: 'type' }> = [
  { id: '2.1', name: '学习', desc: '中英共读', mark: '▶', tone: 'blue' },
  { id: '2.2', name: '中英', desc: '看中说英', mark: '中', tone: 'green' },
  { id: '2.3', name: '英中', desc: '看英说中', mark: 'A', tone: 'sky' },
  // 默写 = 2.2 的「只打字」变体：只显示中文、不朗读、不录音（不新增第四种 PracticeMode）
  { id: '2.2', name: '默写', desc: '看中文写英文', mark: '写', tone: 'pink', input: 'type' },
]

/** 2.1 的副标题跟着播放顺序走（默认只读英文，可在设置页改成中英共读） */
const modes = computed(() => MODES.map((m) => {
  if (m.id !== '2.1') return m
  const desc = settings.data.playOrder === 'en-only' ? '只读英文'
    : settings.data.playOrder === 'zh-en' ? '中 → 英' : '英 → 中'
  return { ...m, desc }
}))

onLoad(async (q) => {
  await settings.load()
  const raw = q?.unitIds || q?.unitId || ''
  unitIds.value = raw.split(',').map((x) => x.trim()).filter(Boolean)
  unitId.value = unitIds.value.join(',')
  if (!unitIds.value.length) return
  const units = await Promise.all(unitIds.value.map((id) => getUnit(id)))
  const titles = units.map((u) => u?.title).filter(Boolean) as string[]
  unitTitle.value = titles.length
    ? titles.join(' · ')
    : (units.length > 1 ? `${units.length} 个单元` : '未命名单元')
  const lists = await Promise.all(unitIds.value.map((id) => listWords(id)))
  words.value = lists.flat()
})

onHide(() => { playToken++; playQueue.stop(); playingId.value = '' })
onUnload(() => { playToken++; playQueue.stop(); playingId.value = '' })
/** 返回上级时先停播（onUnload 发生在页面销毁后，会多响半句）；返回 false 不拦截系统返回 */
onBackPress(() => { playToken++; playQueue.stop(); playingId.value = ''; return false })

function phoneticOf(w: Word) { return w.phonetic_us || w.phonetic_uk }

/* ---------------- 选择模式：勾选多个单词后只练这些 ---------------- */
const allSelected = computed(() => words.value.length > 0 && selected.value.length === words.value.length)

function isSelected(id: string) { return selected.value.includes(id) }

function toggleSelect() {
  selecting.value = !selecting.value
  if (selecting.value) {
    // 进入选择时不播放，避免点击词条误触发朗读
    playToken++
    playQueue.stop()
    playingId.value = ''
  }
}

function onWordTap(w: Word) {
  if (selecting.value) {
    selected.value = isSelected(w.id)
      ? selected.value.filter((id) => id !== w.id)
      : [...selected.value, w.id]
    return
  }
  void playWord(w)
}

function selectAll() {
  selected.value = allSelected.value ? [] : words.value.map((w) => w.id)
}

function clearSelection() { selected.value = [] }

/** 随机模式：只影响进入中英 / 英中时的词条顺序，列表本身仍按原顺序展示 */
async function onRandomChange(e: any) {
  const on = !!e.detail.value
  logger.info('mode.random', { on })
  await settings.set('randomOrder', on)
  uni.showToast({
    title: on ? '已开启：进入中英 / 英中时打乱顺序' : '已关闭随机，按原顺序练习',
    icon: 'none',
  })
}

/** 点单词或右侧播放键：读英文；再次点击正在读的词则停止 */
async function playWord(w: Word) {
  if (!w.word) return
  if (playingId.value === w.id) {
    playToken++
    playQueue.stop()
    playingId.value = ''
    return
  }
  const token = ++playToken
  playQueue.stop()
  playingId.value = w.id
  try {
    await playQueue.playSegments([{ text: w.word, lang: 'en', label: '英文' }], {
      speed: settings.data.speed,
      volume: settings.data.volume,
    })
  } finally {
    if (token === playToken) playingId.value = ''
  }
}

function start(m: { id: PracticeMode; input?: 'type' }) {
  if (!words.value.length) {
    uni.showToast({ title: '本单元还没有词条', icon: 'none' })
    return
  }
  let picks = ''
  if (selecting.value) {
    if (!selected.value.length) {
      uni.showToast({ title: '请先勾选要练习的单词', icon: 'none' })
      return
    }
    // 用下标传参，URL 比逐个带 id 更短；练习页按同一份词表顺序还原
    const idx = words.value
      .map((w, i) => (isSelected(w.id) ? i : -1))
      .filter((i) => i >= 0)
    picks = `&picks=${idx.join(',')}`
    logger.info('mode.start.selected', { mode: m.id, picked: idx.length, total: words.value.length })
  }
  // input=type：默写（2.2 的只打字变体，只显示中文、不朗读、不录音）
  const extra = m.input ? `&input=${m.input}` : ''
  uni.navigateTo({ url: `/pages/practice/practice?unitId=${unitId.value}&mode=${m.id}${extra}${picks}` })
}
</script>

<style scoped>
.mode-page { padding-bottom: 0; }
.unit-hero {
  position: relative; overflow: hidden;
  background: linear-gradient(140deg, #fb923c 0%, #f97316 60%, #ea580c 100%);
  border-radius: 34rpx; padding: 34rpx 32rpx 30rpx; color: #fff;
  box-shadow: 0 16rpx 38rpx rgba(249, 115, 22, .26);
}
.glow { position: absolute; width: 260rpx; height: 260rpx; border-radius: 50%; right: -80rpx; top: -120rpx; background: rgba(255, 255, 255, .14); }
.hero-top { position: relative; display: flex; align-items: center; justify-content: space-between; }
.hero-label { font-size: 21rpx; letter-spacing: 3rpx; color: rgba(255, 255, 255, .7); }
.random-row { display: flex; align-items: center; gap: 8rpx; }
.random-text { font-size: 21rpx; color: rgba(255, 255, 255, .88); }
.random-switch { margin-left: 4rpx; }
.hero-title { display: block; font-size: 44rpx; font-weight: 700; margin-top: 10rpx; }
.hero-meta-row { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-top: 18rpx; }
.hero-meta { display: flex; flex-wrap: wrap; gap: 14rpx; flex: 1; min-width: 0; }
.hero-chip {
  font-size: 22rpx; color: #fff; background: rgba(255, 255, 255, .18);
  border: 1rpx solid rgba(255, 255, 255, .22); border-radius: 999rpx; padding: 6rpx 18rpx;
}
.pick-chip { background: rgba(255, 255, 255, .32); border-color: rgba(255, 255, 255, .5); }
.pick-btn {
  flex-shrink: 0; border-radius: 999rpx; padding: 8rpx 22rpx;
  background: rgba(255, 255, 255, .16); border: 1rpx solid rgba(255, 255, 255, .5);
}
.pick-btn:active { background: rgba(255, 255, 255, .28); }
.pick-btn.active { background: #fff; border-color: #fff; }
.pick-btn-text { font-size: 22rpx; color: #fff; }
.pick-btn.active .pick-btn-text { color: var(--elr-primary-dark); font-weight: 600; }

.list-card.picking { padding-top: 6rpx; }
.pick-tick {
  flex-shrink: 0; width: 40rpx; height: 40rpx; border-radius: 50%;
  border: 2rpx solid #d3d9e8; display: flex; align-items: center; justify-content: center;
  margin-top: 6rpx;
}
.pick-tick.on { background: linear-gradient(135deg, #fdba74, #f97316); border-color: transparent; }
.pick-tick-icon { font-size: 24rpx; color: #fff; line-height: 1; }
.word-item.selected { background: #f5f8ff; }
.word-item.selected .word { color: var(--elr-primary-dark); }

.list-card { padding: 6rpx 28rpx; }
.word-item { display: flex; gap: 20rpx; padding: 24rpx 0; border-bottom: 1rpx solid var(--elr-line); align-items: center; }
.word-item:last-child { border-bottom: none; }
.word-item:active { background: #f9fafe; }
.word-item.playing .word { color: var(--elr-primary-dark); }
.word-index {
  width: 48rpx; height: 48rpx; border-radius: 50%; flex-shrink: 0;
  background: #f3f5fb; color: #9aa2b4; font-size: 20rpx;
  display: flex; align-items: center; justify-content: center; margin-top: 4rpx;
}
.word-main { flex: 1; min-width: 0; }
.word-line { display: flex; align-items: center; flex-wrap: wrap; gap: 12rpx; }
.word { font-size: 32rpx; font-weight: 600; }
.phonetic { font-size: 24rpx; color: var(--elr-muted); }
.pos { font-size: 21rpx; color: var(--elr-primary-dark); background: #fff1e3; border-radius: 8rpx; padding: 2rpx 10rpx; }
.trans { display: block; font-size: 27rpx; color: #3d4456; margin-top: 8rpx; }

.play-btn {
  flex-shrink: 0; width: 64rpx; height: 64rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #fff1e3; color: var(--elr-primary-dark);
  transition: background .2s, color .2s;
}
.play-btn.active {
  background: linear-gradient(135deg, #fdba74, #f97316); color: #fff;
  box-shadow: 0 6rpx 16rpx rgba(249, 115, 22, .32);
}
.play-icon { font-size: 24rpx; line-height: 1; }

.bar-space { height: calc(190rpx + env(safe-area-inset-bottom)); }
.bar-space.taller { height: calc(278rpx + env(safe-area-inset-bottom)); }

.mode-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  display: flex; flex-direction: column; gap: 6rpx;
  padding: 14rpx 18rpx calc(14rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, .97);
  border-top-left-radius: 34rpx; border-top-right-radius: 34rpx;
  box-shadow: 0 -10rpx 34rpx rgba(27, 33, 48, .10);
}
.mode-row { display: flex; gap: 10rpx; }

/* 选择模式：模式条上方的已选摘要 */
.pick-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 16rpx;
  margin: 0 6rpx 6rpx; padding: 12rpx 20rpx;
  background: #fff6ec; border: 1rpx solid #ffe8d2; border-radius: 20rpx;
}
.pick-bar-info { display: flex; flex-direction: column; min-width: 0; }
.pick-bar-count { font-size: 25rpx; font-weight: 600; color: var(--elr-primary-dark); }
.pick-bar-hint { font-size: 20rpx; color: var(--elr-muted); margin-top: 2rpx; }
.pick-bar-actions { display: flex; align-items: center; gap: 24rpx; flex-shrink: 0; }
.pick-action { font-size: 24rpx; color: var(--elr-primary-dark); padding: 6rpx 4rpx; }
.pick-action:active { opacity: .6; }
.mode-item {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 12rpx 6rpx 6rpx; border-radius: 24rpx;
}
.mode-item:active { background: #fdf7f2; }
.mode-icon {
  width: 54rpx; height: 54rpx; border-radius: 18rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 24rpx; font-weight: 700;
}
.mode-icon.blue { background: linear-gradient(135deg, #fdba74, #f97316); }
.mode-icon.green { background: linear-gradient(135deg, #34d399, #10b981); }
.mode-icon.sky { background: linear-gradient(135deg, #38bdf8, #0ea5e9); }
.mode-icon.pink { background: linear-gradient(135deg, #f472b6, #db2777); }
.mode-name { font-size: 26rpx; font-weight: 600; margin-top: 10rpx; }
.mode-desc { font-size: 19rpx; color: var(--elr-muted); margin-top: 2rpx; }
</style>

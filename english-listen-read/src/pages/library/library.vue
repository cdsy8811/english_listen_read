<template>
  <view class="page">
    <!-- 顶部快捷入口 -->
    <view class="lib-quick">
      <view class="quick-card" @click="onCapture">
        <view class="quick-icon blue">拍</view>
        <view class="quick-copy">
          <text class="quick-name">拍照入库</text>
          <text class="quick-sub">识别单词表</text>
        </view>
      </view>
      <view class="quick-card" @click="goWrongbook">
        <view class="quick-icon orange">错</view>
        <view class="quick-copy">
          <text class="quick-name">错词本</text>
          <text class="quick-sub">集中复习</text>
        </view>
      </view>
    </view>

    <!-- 单元管理 -->
    <view class="card">
      <view class="section-head">
        <text class="section-title">学习单元</text>
        <text class="mini-link" @click="onCreateUnit">＋ 新建单元</text>
      </view>

      <picker
        v-if="library.units.length"
        mode="selector"
        :range="unitTitles"
        :value="unitIndex"
        @change="onPickUnit"
      >
        <view class="unit-picker">
          <view class="unit-picker-main">
            <text class="unit-picker-title">{{ library.currentUnit?.title || '请选择单元' }}</text>
            <text class="unit-picker-sub">{{ library.units.length }} 个单元 · 当前 {{ library.words.length }} 个词条</text>
          </view>
          <text class="unit-picker-arrow">▾</text>
        </view>
      </picker>
      <view v-else class="unit-picker" @click="onCreateUnit">
        <view class="unit-picker-main">
          <text class="unit-picker-title">还没有学习单元</text>
          <text class="unit-picker-sub">点这里新建第一个单元</text>
        </view>
        <text class="unit-picker-arrow">＋</text>
      </view>

      <view v-if="library.currentUnit" class="unit-ops">
        <button class="btn btn-sm practice-btn" @click="goPractice">开始练习</button>
        <text class="mini-link" @click="onRenameUnit">重命名</text>
        <text class="mini-link danger" @click="onDeleteUnit">删除单元</text>
      </view>
    </view>

    <!-- 词条编辑 -->
    <view v-if="library.currentUnit" class="card">
      <view class="section-head">
        <text class="section-title">单词列表</text>
        <text class="section-more">{{ library.visibleWords.length }} / {{ library.words.length }}</text>
      </view>
      <view class="search-box">
        <view class="search-icon">
          <view class="search-lens" />
          <view class="search-handle" />
        </view>
        <input class="search-input" v-model="library.keyword" placeholder="搜索单词 / 中文释义" />
      </view>
      <view class="word-toolbar">
        <text class="sub">内容正确度低于设定线会自动收录到错词本</text>
        <button class="btn btn-ghost btn-sm" @click="onAddWord">＋ 加词</button>
      </view>

      <view class="word-list">
        <view class="word-item" v-for="w in library.visibleWords" :key="w.id">
          <view class="word-main">
            <view class="word-line">
              <text class="word">{{ w.word }}</text>
              <text v-if="w.phonetic_us" class="phonetic">{{ w.phonetic_us }}</text>
              <text v-if="w.pos" class="pos">{{ w.pos }}</text>
              <text v-if="w.wrong" class="wrong-tag">错词</text>
            </view>
            <text class="trans">{{ w.translation || '（未填释义）' }}</text>
            <text v-if="w.example" class="example">{{ w.example }}</text>
          </view>
          <view class="word-actions">
            <text class="mini-link" @click="onEditWord(w)">编辑</text>
            <text class="mini-link danger" @click="onDeleteWord(w)">删除</text>
          </view>
        </view>
      </view>
      <view v-if="!library.visibleWords.length" class="empty">
        {{ library.keyword ? '没有匹配的词条' : '本单元还没有词条，点「加词」或拍照入库' }}
      </view>
    </view>

    <view v-else class="card empty-card">
      <text class="empty-title">还没有可编辑的单元</text>
      <text class="sub">新建单元，或用拍照把单词表变成词库</text>
    </view>

    <!-- 载入示例词库 -->
    <button class="btn btn-plain seed-btn" @click="onSeed">
      载入初一词汇（{{ SEED_UNITS }} 单元 / {{ SEED_WORDS }} 词）
    </button>

    <!-- 编辑弹层 -->
    <view v-if="editing" class="mask" @click.self="editing = false">
      <view class="sheet">
        <WordEditor :value="editDraft" :is-new="!editingId" @save="onSaveWord" @cancel="editing = false" />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import WordEditor from '@/components/WordEditor.vue'
import { useLibraryStore } from '@/store/library'
import * as repo from '@/services/storage'
import { seedBuiltinVocab, SEED_UNITS, SEED_WORDS } from '@/services/seed'
import { ensurePrivacyNotice } from '@/utils/privacy'
import type { Word, WordDraft } from '@/services/types'

const library = useLibraryStore()
const editing = ref(false)
const editingId = ref('')
const editDraft = ref<WordDraft | undefined>()

const unitTitles = computed(() => library.units.map((u) => u.title))
const unitIndex = computed(() => Math.max(0, library.units.findIndex((u) => u.id === library.currentUnitId)))

onShow(async () => {
  void ensurePrivacyNotice()
  await library.refreshUnits()
  if (!library.currentUnitId && library.units.length) await library.openUnit(library.units[0].id)
  else if (library.currentUnitId) await library.openUnit(library.currentUnitId)
})

onPullDownRefresh(async () => {
  await library.refreshUnits()
  if (library.currentUnitId) await library.openUnit(library.currentUnitId)
  uni.stopPullDownRefresh()
})

function onCapture() { uni.navigateTo({ url: '/pages/capture/capture' }) }
function goWrongbook() { uni.navigateTo({ url: '/pages/wrongbook/wrongbook' }) }
function onPickUnit(e: { detail: { value: number } }) {
  const u = library.units[Number(e.detail.value)]
  if (u && u.id !== library.currentUnitId) void library.openUnit(u.id)
}
function goPractice() {
  if (!library.words.length) {
    uni.showToast({ title: '本单元还没有词条', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/mode/mode?unitId=${library.currentUnitId}` })
}

function onSeed() {
  uni.showModal({
    title: '载入初一词汇',
    content: `将写入 ${SEED_UNITS} 个学习单元、${SEED_WORDS} 个词条（人教版七年级上下册 Vocabulary in Each Unit 教材词汇表）。同 id 覆盖，重复载入不会建重复单元，也不影响你手动添加的内容。`,
    confirmText: '载入',
    success: async (r) => {
      if (!r.confirm) return
      try {
        const out = await seedBuiltinVocab()
        await library.refreshUnits()
        if (library.units.length) await library.openUnit(library.units[0].id)
        uni.showToast({ title: `已载入 ${out.units} 单元 / ${out.words} 词`, icon: 'success' })
      } catch (e) {
        uni.showToast({ title: (e as Error).message || '载入失败', icon: 'none' })
      }
    },
  })
}

function onCreateUnit() {
  uni.showModal({
    title: '新建学习单元', editable: true, placeholderText: '如 Unit 1 / 第一单元',
    success: async (r) => {
      if (!r.confirm || !r.content?.trim()) return
      const u = await library.addUnit(r.content.trim())
      await library.openUnit(u.id)
    },
  })
}

function onRenameUnit() {
  const u = library.currentUnit
  if (!u) return
  uni.showModal({
    title: '重命名单元', editable: true, placeholderText: u.title,
    success: async (r) => {
      if (r.confirm && r.content?.trim()) await library.renameUnit(u.id, r.content.trim())
    },
  })
}

function onDeleteUnit() {
  const u = library.currentUnit
  if (!u) return
  uni.showModal({
    title: '删除单元', content: `将同时删除「${u.title}」下的所有词条，不可恢复。`,
    success: async (r) => { if (r.confirm) await library.removeUnit(u.id) },
  })
}

function onAddWord() { editingId.value = ''; editDraft.value = undefined; editing.value = true }

function onEditWord(w: Word) {
  editingId.value = w.id
  editDraft.value = { word: w.word, phonetic: w.phonetic_us || w.phonetic_uk, pos: w.pos, translation: w.translation, example: w.example }
  editing.value = true
}

async function onSaveWord(d: WordDraft) {
  const unitId = library.currentUnitId
  if (!unitId) return
  const existing = editingId.value ? await findWord(editingId.value) : null
  const w: Word = existing
    ? { ...existing, word: d.word, phonetic_us: d.phonetic, pos: d.pos, translation: d.translation, example: d.example || '' }
    : repo.draftToWord(d, unitId, library.words.length)
  await library.saveWord(w)
  editing.value = false
  uni.showToast({ title: '已保存', icon: 'success' })
}

async function findWord(id: string): Promise<Word | null> {
  return library.words.find((w) => w.id === id) || null
}

function onDeleteWord(w: Word) {
  uni.showModal({
    title: '删除词条', content: `删除「${w.word}」？`,
    success: async (r) => { if (r.confirm) await library.removeWord(w.id) },
  })
}
</script>

<style scoped>
.lib-quick { display: flex; gap: 18rpx; margin-bottom: 24rpx; }
.quick-card {
  flex: 1; display: flex; align-items: center; gap: 18rpx;
  background: #fff; border-radius: 26rpx; padding: 22rpx 24rpx;
  box-shadow: 0 8rpx 24rpx rgba(27, 33, 48, .05);
}
.quick-card:active { opacity: .85; }
.quick-icon {
  width: 64rpx; height: 64rpx; border-radius: 20rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 27rpx; font-weight: 600;
}
.quick-icon.blue { background: linear-gradient(135deg, #fdba74, #f97316); }
.quick-icon.orange { background: linear-gradient(135deg, #fb7185, #f43f5e); }
.quick-copy { display: flex; flex-direction: column; min-width: 0; }
.quick-name { font-size: 27rpx; font-weight: 600; }
.quick-sub { font-size: 21rpx; color: var(--elr-muted); margin-top: 4rpx; }

.unit-picker {
  display: flex; align-items: center; justify-content: space-between; gap: 16rpx;
  background: #fffaf5; border: 1rpx solid #ffe8d2; border-radius: 22rpx;
  padding: 22rpx 26rpx; margin-top: 6rpx;
}
.unit-picker:active { background: #fff4e8; }
.unit-picker-main { display: flex; flex-direction: column; min-width: 0; }
.unit-picker-title { font-size: 30rpx; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unit-picker-sub { font-size: 22rpx; color: var(--elr-muted); margin-top: 6rpx; }
.unit-picker-arrow { flex-shrink: 0; color: var(--elr-primary-dark); font-size: 28rpx; }

.unit-ops { display: flex; align-items: center; gap: 30rpx; margin-top: 20rpx; padding-top: 20rpx; border-top: 1rpx solid var(--elr-line); }
.practice-btn { margin: 0 8rpx 0 0; }

.mini-link { font-size: 24rpx; color: var(--elr-primary-dark); }
.mini-link.danger { color: var(--elr-err); }

.search-box { display: flex; align-items: center; gap: 14rpx; background: #fdf7f2; border-radius: 999rpx; padding: 0 24rpx; }
.search-icon { width: 34rpx; height: 34rpx; position: relative; flex-shrink: 0; }
.search-lens { position: absolute; left: 2rpx; top: 2rpx; width: 22rpx; height: 22rpx; border: 3rpx solid var(--elr-muted); border-radius: 50%; }
.search-handle { position: absolute; right: 3rpx; bottom: 5rpx; width: 13rpx; height: 3rpx; border-radius: 2rpx; background: var(--elr-muted); transform: rotate(45deg); }
.search-input { flex: 1; height: 80rpx; font-size: 27rpx; }
.word-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin: 20rpx 0 8rpx; }
.word-toolbar .sub { flex: 1; }

.word-list { margin-top: 4rpx; }
.word-item { display: flex; gap: 18rpx; padding: 24rpx 0; border-bottom: 1rpx solid var(--elr-line); }
.word-item:last-child { border-bottom: none; padding-bottom: 6rpx; }
.word-main { flex: 1; min-width: 0; }
.word-line { display: flex; align-items: center; flex-wrap: wrap; gap: 12rpx; }
.word { font-size: 32rpx; font-weight: 600; }
.phonetic { font-size: 24rpx; color: var(--elr-muted); }
.pos { font-size: 21rpx; color: var(--elr-primary-dark); background: #fff1e3; border-radius: 8rpx; padding: 2rpx 10rpx; }
.wrong-tag { font-size: 21rpx; color: var(--elr-warn); background: #fff5e6; border-radius: 8rpx; padding: 2rpx 10rpx; }
.trans { display: block; font-size: 27rpx; color: #3d4456; margin-top: 8rpx; }
.example { display: block; font-size: 23rpx; color: var(--elr-muted); margin-top: 6rpx; }
.word-actions { display: flex; flex-direction: column; gap: 14rpx; align-items: flex-end; justify-content: center; }

.empty-card { display: flex; flex-direction: column; align-items: center; padding: 50rpx 40rpx; }
.empty-title { font-size: 30rpx; font-weight: 600; margin-bottom: 10rpx; }

.seed-btn { width: 100%; margin-top: 24rpx; }

.mask { position: fixed; inset: 0; background: rgba(20, 24, 34, .45); display: flex; align-items: flex-end; z-index: 20; }
.sheet { width: 100%; background: #fff; border-radius: 28rpx 28rpx 0 0; padding: 32rpx 28rpx 60rpx; }
</style>

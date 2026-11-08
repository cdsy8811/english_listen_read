<template>
  <view class="page">
    <!-- 顶部：单元选择 / 操作 -->
    <view class="card">
      <view class="row">
        <text class="title">我的词库</text>
        <view class="row-start">
          <button class="btn btn-ghost btn-sm" @click="onCapture">拍照入库</button>
          <button class="btn btn-plain btn-sm" @click="goWrongbook">错词本</button>
        </view>
      </view>
      <text class="sub">按「学习单元」分组，断网也能查看与编辑</text>
      <view class="divider" />
      <view class="row">
        <button class="btn btn-plain btn-sm" style="flex: 1" @click="onCreateUnit">新建单元</button>
        <button class="btn btn-plain btn-sm" style="flex: 1; margin-left: 16rpx" @click="onExport">导出</button>
        <button class="btn btn-plain btn-sm" style="flex: 1; margin-left: 16rpx" @click="onImport">导入</button>
      </view>
      <button class="btn btn-ghost btn-sm" style="margin-top: 16rpx" @click="onSeed">
        载入初一词汇（人教版教材 · {{ SEED_UNITS }} 单元 / {{ SEED_WORDS }} 词）
      </button>
      <view class="divider" />
      <scroll-view scroll-x class="unit-bar">
        <view
          v-for="u in library.units" :key="u.id"
          class="unit-chip" :class="{ active: u.id === library.currentUnitId }"
          @click="onSelectUnit(u.id)"
        >{{ u.title }}</view>
        <view v-if="!library.units.length" class="sub">还没有单元，点「新建单元」开始</view>
      </scroll-view>
      <view v-if="library.currentUnit" class="row" style="margin-top: 20rpx">
        <text class="sub">{{ library.visibleWords.length }} 个词条</text>
        <view class="row-start">
          <button class="btn btn-plain btn-sm" @click="onRenameUnit">重命名</button>
          <button class="btn btn-danger btn-sm" @click="onDeleteUnit">删除单元</button>
        </view>
      </view>
    </view>

    <!-- 搜索 + 加词 + 练习 -->
    <view class="card" v-if="library.currentUnit">
      <input class="input" v-model="library.keyword" placeholder="搜索单词 / 中文释义" />
      <view class="row" style="margin-top: 20rpx">
        <button class="btn btn-ghost" style="flex: 1; margin-right: 16rpx" @click="onAddWord">手动加词</button>
        <button class="btn" style="flex: 1" @click="goPractice">开始练习</button>
      </view>
    </view>

    <!-- 词条列表 -->
    <view v-if="library.currentUnit" class="card" v-for="w in library.visibleWords" :key="w.id">
      <view class="row-start" style="align-items: flex-start">
        <view style="flex: 1">
          <view class="row-start" style="flex-wrap: wrap">
            <text class="word">{{ w.word }}</text>
            <text v-if="w.phonetic_us" class="phonetic">{{ w.phonetic_us }}</text>
            <text v-if="w.pos" class="tag">{{ w.pos }}</text>
            <text v-if="w.wrong" class="tag" style="color: var(--elr-warn); background: #fff3e6">错词</text>
          </view>
          <text class="translation">{{ w.translation || '（未填释义）' }}</text>
          <text v-if="w.example" class="sub">{{ w.example }}</text>
        </view>
        <view style="display: flex; flex-direction: column; gap: 12rpx">
          <button class="btn btn-plain btn-sm" @click="onEditWord(w)">编辑</button>
          <button class="btn btn-danger btn-sm" @click="onDeleteWord(w)">删除</button>
        </view>
      </view>
    </view>
    <view v-if="library.currentUnit && !library.visibleWords.length" class="empty">
      本单元还没有词条。可以「手动加词」，或后续用拍照入库批量导入。
    </view>

    <!-- 编辑弹层 -->
    <view v-if="editing" class="mask" @click.self="editing = false">
      <view class="sheet">
        <WordEditor :value="editDraft" :is-new="!editingId" @save="onSaveWord" @cancel="editing = false" />
      </view>
    </view>
    <!-- 导入弹层 -->
    <view v-if="importing" class="mask" @click.self="importing = false">
      <view class="sheet">
        <text class="title">导入词库 JSON</text>
        <textarea class="input" style="height: 320rpx; margin: 20rpx 0" v-model="importText" placeholder="粘贴本应用导出的 JSON" />
        <view class="row">
          <button class="btn btn-plain" style="flex: 1; margin-right: 16rpx" @click="importing = false">取消</button>
          <button class="btn" style="flex: 1" @click="doImport">导入</button>
        </view>
        <button v-if="fileBackupAvailable()" class="btn btn-ghost" style="margin-top: 20rpx" @click="onImportFromFile">从本地备份文件导入</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { ref } from 'vue'
import WordEditor from '@/components/WordEditor.vue'
import { useLibraryStore } from '@/store/library'
import * as repo from '@/services/storage'
import { exportLibrary, importLibraryJson } from '@/services/library-io'
import { seedBuiltinVocab, SEED_UNITS, SEED_WORDS } from '@/services/seed'
import { fileBackupAvailable, listBackups, readBackup } from '@/services/backup'
import { ensurePrivacyNotice } from '@/utils/privacy'
import type { Word, WordDraft } from '@/services/types'

const library = useLibraryStore()
const editing = ref(false)
const editingId = ref('')
const editDraft = ref<WordDraft | undefined>()
const importing = ref(false)
const importText = ref('')

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

function onSelectUnit(id: string) { void library.openUnit(id) }
function onCapture() { uni.navigateTo({ url: '/pages/capture/capture' }) }
function goWrongbook() { uni.navigateTo({ url: '/pages/wrongbook/wrongbook' }) }
function goPractice() {
  if (!library.words.length) {
    uni.showToast({ title: '本单元还没有词条', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/mode/mode?unitId=${library.currentUnitId}` })
}

/* ---------------- 本地导入导出（纯本地，无账号无同步） ---------------- */

async function onExport() {
  try {
    const r = await exportLibrary()
    // 剪贴板是必给路径：用户可直接把词库粘到别处，也便于从文件管理器取用
    await new Promise<void>((resolve) => uni.setClipboardData({
      data: r.json, success: () => resolve(), fail: () => resolve(),
    }))
    uni.showModal({
      title: '导出完成',
      content: r.path
        ? `已保存备份：${r.path}\n共 ${r.units} 个单元 / ${r.words} 个词条，JSON 也已复制到剪贴板。`
        : `共 ${r.units} 个单元 / ${r.words} 个词条，JSON 已复制到剪贴板，请粘贴保存。`,
      showCancel: false,
    })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '导出失败', icon: 'none' })
  }
}

function onImport() { importText.value = ''; importing.value = true }

/** 一键载入内置初一词汇：同 id 覆盖，重复点不会重复建单元。 */
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

async function applyImport(text: string) {
  const r = await importLibraryJson(text)
  importing.value = false
  await library.refreshUnits()
  if (library.currentUnitId) await library.openUnit(library.currentUnitId)
  uni.showToast({ title: `导入 ${r.units} 单元 / ${r.words} 词`, icon: 'success' })
}

async function doImport() {
  try { await applyImport(importText.value) }
  catch (e) { uni.showToast({ title: (e as Error).message || '导入失败', icon: 'none' }) }
}

async function onImportFromFile() {
  try {
    const files = await listBackups()
    if (!files.length) { uni.showToast({ title: '还没有本地备份文件', icon: 'none' }); return }
    uni.showActionSheet({
      itemList: files.slice(0, 8).map((f) => f.name),
      success: async (r) => {
        try { await applyImport(await readBackup(files[r.tapIndex].url)) }
        catch (e) { uni.showToast({ title: (e as Error).message || '导入失败', icon: 'none' }) }
      },
    })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '读取备份失败', icon: 'none' })
  }
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
.unit-bar { white-space: nowrap; display: flex; gap: 16rpx; }
.unit-chip { display: inline-block; padding: 12rpx 28rpx; background: #f4f6fb; border-radius: 999rpx; font-size: 26rpx; color: var(--elr-muted); }
.unit-chip.active { background: var(--elr-primary); color: #fff; }
.word { font-size: 34rpx; font-weight: 600; }
.phonetic { font-size: 26rpx; color: var(--elr-muted); }
.translation { display: block; font-size: 28rpx; margin-top: 8rpx; }
.mask { position: fixed; inset: 0; background: rgba(20, 24, 34, .45); display: flex; align-items: flex-end; z-index: 20; }
.sheet { width: 100%; background: #fff; border-radius: 28rpx 28rpx 0 0; padding: 32rpx 28rpx 60rpx; }
</style>

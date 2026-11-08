<template>
  <view class="page">
    <view class="card">
      <view class="row">
        <text class="title">错词本</text>
        <text class="tag">{{ words.length }} 个待复习</text>
      </view>
      <text class="sub">内容正确度低于设定线的词条自动收录；标记「已掌握」后移出。</text>
      <view class="row" style="margin-top: 20rpx">
        <button class="btn btn-ghost btn-sm" :disabled="!words.length" @click="onDrill">重练这些词</button>
        <button class="btn btn-plain btn-sm" @click="onExport">导出词库</button>
        <button class="btn btn-plain btn-sm" @click="onImport">导入词库</button>
      </view>
    </view>

    <view class="card" v-for="w in words" :key="w.id">
      <view class="row-start" style="align-items: flex-start">
        <view style="flex: 1">
          <view class="row-start" style="flex-wrap: wrap">
            <text class="word">{{ w.word }}</text>
            <text v-if="w.phonetic_us" class="sub">{{ w.phonetic_us }}</text>
            <text class="tag" style="color: var(--elr-warn); background: #fff3e6">错 {{ w.wrong_count }} 次</text>
          </view>
          <text class="translation">{{ w.translation }}</text>
        </view>
        <button class="btn btn-plain btn-sm" @click="onMastered(w.id)">已掌握</button>
      </view>
    </view>
    <view v-if="!words.length" class="empty">错词本是空的，继续保持。</view>

    <!-- 导入弹层 -->
    <view v-if="importing" class="mask" @click.self="importing = false">
      <view class="sheet">
        <text class="title">导入词库 JSON</text>
        <textarea class="input" style="height: 320rpx; margin: 20rpx 0" v-model="importText"
          placeholder="粘贴本应用导出的 JSON" />
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
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { listWrongWords, markMastered } from '@/services/storage'
import { exportLibrary, importLibraryJson } from '@/services/library-io'
import { fileBackupAvailable, listBackups, readBackup } from '@/services/backup'
import type { Word } from '@/services/types'
import { useLibraryStore } from '@/store/library'

const library = useLibraryStore()
const words = ref<Word[]>([])
const importing = ref(false)
const importText = ref('')

onShow(async () => { words.value = await listWrongWords() })

async function onMastered(id: string) {
  await markMastered(id)
  words.value = await listWrongWords()
  await library.refreshUnits()
  if (library.currentUnitId) await library.openUnit(library.currentUnitId)
  uni.showToast({ title: '已移出错词本', icon: 'success' })
}

function onDrill() {
  if (!words.value.length) return
  // 用第一个错词所在单元开一轮 2.2 练习
  const unitId = words.value[0].unit_id
  uni.navigateTo({ url: `/pages/practice/practice?unitId=${unitId}&mode=2.2` })
}

async function onExport() {
  try {
    const r = await exportLibrary()
    await new Promise<void>((resolve) => uni.setClipboardData({
      data: r.json, success: () => resolve(), fail: () => resolve(),
    }))
    uni.showModal({
      title: '导出完成',
      content: r.path
        ? `已保存备份：${r.path}\n共 ${r.units} 个单元 / ${r.words} 个词条，JSON 也已复制到剪贴板。`
        : `共 ${r.units} 个单元 / ${r.words} 个词条，JSON 已复制到剪贴板。`,
      showCancel: false,
    })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '导出失败', icon: 'none' })
  }
}

function onImport() { importText.value = ''; importing.value = true }

async function applyImport(text: string) {
  const r = await importLibraryJson(text)
  importing.value = false
  words.value = await listWrongWords()
  await library.refreshUnits()
  if (library.currentUnitId) await library.openUnit(library.currentUnitId)
  uni.showToast({ title: `已导入 ${r.units} 单元 / ${r.words} 词`, icon: 'success' })
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
</script>

<style scoped>
.word { font-size: 34rpx; font-weight: 600; }
.translation { display: block; font-size: 28rpx; margin-top: 8rpx; }
.mask { position: fixed; inset: 0; background: rgba(20, 24, 34, .45); display: flex; align-items: flex-end; z-index: 20; }
.sheet { width: 100%; background: #fff; border-radius: 28rpx 28rpx 0 0; padding: 32rpx 28rpx 60rpx; }
</style>

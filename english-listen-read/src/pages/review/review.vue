<template>
  <view class="page">
    <view class="card">
      <text class="title">识别校对（必做）</text>
      <view class="divider" />
      <text class="sub">音标由模型按单词重新生成（OCR 音标实测 3/3 损坏）；入库前请逐条确认。</text>

      <!-- 学习单元：名称直接可编辑；点右侧「更改」可从预设 / 已有单元里挑 -->
      <view class="unit-field">
        <view style="flex: 1; min-width: 0">
          <text class="label">学习单元</text>
          <input class="input unit-input" :value="newUnitTitle" maxlength="40" placeholder="如：七上 Unit 1"
            @input="onNameInput" />
          <text class="sub unit-hint">{{ unitHint }}</text>
        </view>
        <view class="unit-change" @click="unitPicker = true"><text>更改</text></view>
      </view>

      <view class="row" style="margin-top: 20rpx">
        <text class="sub">{{ capture.drafts.length }} 条待确认</text>
        <view class="row-start">
          <button class="btn btn-plain btn-sm" @click="onAdd">加一条</button>
          <button class="btn btn-ghost btn-sm" @click="onRedo">重新识别</button>
        </view>
      </view>
    </view>

    <view v-if="loading" class="card">
      <text class="title">{{ stage }}</text>
      <view class="divider" />
      <text class="sub">云端长输出可能需要 60–90 秒，请保持网络畅通。</text>
      <progress :percent="progress" show-info stroke-width="6" activeColor="#f97316" />
    </view>

    <view v-if="error" class="card">
      <text class="title" style="color: var(--elr-err)">识别没成功</text>
      <text class="sub">{{ error }}</text>
      <button class="btn btn-ghost" style="margin-top: 20rpx" @click="onRedo">再试一次</button>
    </view>

    <view class="card" v-for="(d, i) in capture.drafts" :key="i">
      <view class="row-start" style="align-items: flex-start">
        <view style="flex: 1">
          <view class="row-start" style="flex-wrap: wrap">
            <text class="word">{{ d.word || '（空）' }}</text>
            <text v-if="d.phonetic" class="phonetic">{{ d.phonetic }}</text>
            <text v-if="d.pos" class="tag">{{ d.pos }}</text>
          </view>
          <text class="translation">{{ d.translation || '（未识别到释义，请补填）' }}</text>
        </view>
        <view style="display: flex; flex-direction: column; gap: 12rpx">
          <button class="btn btn-plain btn-sm" @click="onEdit(i)">编辑</button>
          <button class="btn btn-danger btn-sm" @click="onRemove(i)">删除</button>
        </view>
      </view>
    </view>

    <view v-if="!loading && capture.drafts.length" class="card">
      <button class="btn" @click="onConfirm">确认入库（{{ capture.drafts.length }} 条）</button>
      <text class="sub" style="display: block; margin-top: 16rpx; text-align: center">保存后可在「词库」中编辑、搜索与练习</text>
    </view>

    <view v-if="editing" class="mask" @click.self="editing = false">
      <view class="sheet">
        <WordEditor :value="editDraft" :is-new="false" @save="onSaveEdit" @cancel="editing = false" />
      </view>
    </view>

    <!-- 学习单元选择器：名称可直接输入，也可点已有单元追加 -->
    <view v-if="unitPicker" class="mask" @click.self="unitPicker = false">
      <view class="sheet">
        <text class="title">选择学习单元</text>
        <text class="sub">点上方名称框可直接改名；这里可以挑预设名称，或追加到已有单元</text>
        <view class="divider" />

        <text class="label">新建单元（点一下填入上面的名称框）</text>
        <view class="name-chips">
          <view
            v-for="name in newNameOptions"
            :key="name"
            class="name-chip"
            :class="{ 'name-chip-on': !targetUnitId && newUnitTitle === name }"
            @click="chooseNewUnit(name)"
          >
            <text>{{ name }}</text>
          </view>
        </view>

        <text class="label" style="margin-top: 24rpx">{{ library.units.length ? '或追加到已有单元（点名称右侧「改名」可重命名）' : '已有单元' }}</text>
        <scroll-view scroll-y class="unit-list">
          <view
            v-for="u in library.units"
            :key="u.id"
            class="unit-option"
            :class="{ 'unit-option-on': targetUnitId === u.id }"
            @click="chooseExisting(u)"
          >
            <view class="unit-option-row">
              <text class="unit-option-title">{{ u.title }}</text>
              <text class="unit-rename" @click.stop="onRenameUnit(u)">改名</text>
            </view>
            <text class="sub">{{ targetUnitId === u.id ? '已选中，词条会追加到这里' : '点击追加词条' }}</text>
          </view>
          <view v-if="!library.units.length" class="unit-option">
            <text class="sub">目前还没有单元，直接用上面的名称新建即可</text>
          </view>
        </scroll-view>

        <button class="btn btn-plain" style="margin-top: 20rpx" @click="unitPicker = false">取消</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import WordEditor from '@/components/WordEditor.vue'
import { useCaptureStore } from '@/store/capture'
import { useLibraryStore } from '@/store/library'
import { recognize, extractWords } from '@/services'
import { parsePlainTextDrafts } from '@/services/parser-text'
import { draftToWord, saveWords, createUnit, listWords } from '@/services/storage'
import type { WordDraft, Unit } from '@/services/types'
import { configSummary, cloudAvailable } from '@/api/runtime-config'
import { logger } from '@/utils/log'

const capture = useCaptureStore()
const library = useLibraryStore()
const loading = ref(false)
const error = ref('')
const stage = ref('')
const progress = ref(0)
const editing = ref(false)
const editIndex = ref(-1)
const editDraft = ref<WordDraft | undefined>()
const unitPicker = ref(false)
/** 空串 = 新建单元；非空 = 追加到该已有单元 */
const targetUnitId = ref('')
const newUnitTitle = ref('')
let localMode = false

const todayName = (prefix: string) => `${prefix} ${new Date().toLocaleDateString('zh-CN')}`
const selectedUnit = computed<Unit | null>(() => library.units.find((u) => u.id === targetUnitId.value) || null)
const unitHint = computed(() => selectedUnit.value
  ? `本次追加到已有单元「${selectedUnit.value.title}」· 改上面的名字会变成新建单元`
  : '保存时按此名称新建单元，可直接改成任意名字')
/** 不用输入框也能挑一个像样的名字：默认名 + 按顺序的 Unit N / 第 N 单元 */
const newNameOptions = computed(() => {
  const n = library.units.length + 1
  return Array.from(new Set([
    capture.unitTitle || todayName('拍照词库'),
    `Unit ${n}`,
    `第 ${n} 单元`,
  ]))
})

onLoad((query) => {
  localMode = query?.local === '1'
  newUnitTitle.value = capture.unitTitle || todayName('拍照词库')
  void library.refreshUnits()
  if (localMode && capture.drafts.length) return
  void run()
})

function chooseNewUnit(name: string) {
  newUnitTitle.value = name
  targetUnitId.value = ''
  unitPicker.value = false
}

/** 直接输入单元名：一旦有输入就切回「新建单元」 */
function onNameInput(e: any) {
  newUnitTitle.value = String(e.detail.value || '')
  targetUnitId.value = ''
}

/** 给已有单元改名（系统可编辑弹窗，与词库页一致） */
function onRenameUnit(u: Unit) {
  uni.showModal({
    title: '重命名单元',
    editable: true,
    placeholderText: u.title,
    content: u.title,
    success: async (r) => {
      const title = (r.content || '').trim()
      if (!r.confirm || !title || title === u.title) return
      try {
        await library.renameUnit(u.id, title)
        logger.debug('review.unit.rename', { id: u.id, chars: title.length })
      } catch (_) {
        uni.showToast({ title: '重命名失败', icon: 'none' })
      }
    },
  })
}

function chooseExisting(u: Unit) {
  targetUnitId.value = u.id
  // 名称框同步显示选中的单元名；之后再改字就会自动切回「新建单元」
  newUnitTitle.value = u.title
  unitPicker.value = false
}

async function run() {
  error.value = ''
  if (localMode) {
    capture.drafts = parsePlainTextDrafts(capture.markdown)
    if (!capture.drafts.length) error.value = '本地文本没解析出词条，请返回修改。'
    return
  }
  if (!capture.image) { error.value = '没有待识别的图片，请返回重新拍照。'; return }
  const cfg = configSummary()
  if (!cloudAvailable()) {
    error.value = `云能力未就绪（缺少：${cfg.missing.join(', ') || '未知'}）。请返回改用「文本生成词条」，本地功能完全可用。`
    return
  }
  loading.value = true
  stage.value = '正在识别图片文字…'
  progress.value = 20
  try {
    const markdown = await recognize(capture.image.base64, capture.image.encoding)
    capture.markdown = markdown
    progress.value = 55
    stage.value = '正在抽取词条并重新生成音标…'
    capture.drafts = await extractWords(markdown)
    progress.value = 100
    if (!capture.drafts.length) error.value = '没识别到词条，请换一张更清晰的图片或改用文本输入。'
  } catch (e) {
    error.value = (e as Error).message || '识别失败'
  } finally {
    loading.value = false
  }
}

function onRedo() { localMode = false; void run() }

function onEdit(i: number) {
  editIndex.value = i
  editDraft.value = { ...capture.drafts[i] }
  editing.value = true
}

function onSaveEdit(d: WordDraft) {
  capture.drafts.splice(editIndex.value, 1, d)
  editing.value = false
}

function onAdd() { capture.drafts.push({ word: '', phonetic: '', pos: '', translation: '' }) }

function onRemove(i: number) { capture.drafts.splice(i, 1) }

async function onConfirm() {
  const bad = capture.drafts.find((d) => !d.word.trim() || !d.translation.trim())
  if (bad) {
    uni.showToast({ title: '每条都要有英文单词和中文释义', icon: 'none' })
    return
  }
  if (!targetUnitId.value && !newUnitTitle.value.trim()) {
    uni.showToast({ title: '请填写单元名称', icon: 'none' })
    return
  }
  uni.showLoading({ title: '正在保存' })
  try {
    let unitId = targetUnitId.value
    let sortStart = 0
    if (unitId) {
      // 追加到已有单元：排序接在现有词条之后，避免与已有 sort 冲突
      const existing = await listWords(unitId)
      sortStart = existing.length ? Math.max(0, ...existing.map((w) => Number(w.sort) || 0)) + 1 : 0
    } else {
      const unit = await createUnit(newUnitTitle.value.trim() || `词库 ${Date.now()}`, capture.sourceImgPath)
      unitId = unit.id
    }
    const words = capture.drafts.map((d, i) => draftToWord(d, unitId, sortStart + i))
    await saveWords(words)
    await library.refreshUnits()
    await library.openUnit(unitId)
    capture.clear()
    uni.hideLoading()
    uni.showToast({ title: '已入库', icon: 'success' })
    setTimeout(() => uni.switchTab({ url: '/pages/index/index' }), 600)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message || '保存失败', icon: 'none' })
  }
}
</script>

<style scoped>
.label { display: block; font-size: 26rpx; color: var(--elr-muted); margin-bottom: 10rpx; }
.word { font-size: 34rpx; font-weight: 600; }
.phonetic { font-size: 26rpx; color: var(--elr-muted); }
.translation { display: block; font-size: 28rpx; margin-top: 8rpx; }
.mask { position: fixed; inset: 0; background: rgba(20, 24, 34, .45); display: flex; align-items: flex-end; z-index: 20; }
.sheet { width: 100%; background: #fff; border-radius: 28rpx 28rpx 0 0; padding: 32rpx 28rpx 60rpx; }

/* 单元名：可编辑输入框，名称过长时在框内换行显示 */
.unit-field { display: flex; align-items: center; gap: 16rpx; background: #faf5f0; border-radius: 16rpx; padding: 22rpx 24rpx; margin-top: 20rpx; }
.unit-input { background: #fff; }
.unit-hint { display: block; margin-top: 10rpx; font-size: 24rpx; line-height: 1.5; }
.unit-change { flex-shrink: 0; color: var(--elr-primary-dark); font-size: 26rpx; padding: 10rpx 20rpx; background: #fff; border-radius: 999rpx; }
.unit-option { background: #faf5f0; border-radius: 14rpx; padding: 20rpx 24rpx; margin-bottom: 14rpx; }
.unit-option-on { background: #fff4e8; border: 2rpx solid var(--elr-primary); }
.unit-option-title { display: block; font-size: 30rpx; color: var(--elr-text); line-height: 1.5; word-break: break-all; }
.unit-option-row { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.unit-rename { flex-shrink: 0; font-size: 24rpx; color: var(--elr-primary-dark); padding: 6rpx 16rpx; background: #fff; border-radius: 999rpx; }
.name-chips { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 14rpx; }
.name-chip { font-size: 24rpx; color: var(--elr-primary-dark); background: #fff1e3; border-radius: 999rpx; padding: 10rpx 22rpx; }
.name-chip-on { background: var(--elr-primary); color: #fff; }
.unit-list { height: 400rpx; }
</style>

<template>
  <view class="page" :class="{ 'has-drill-bar': words.length }">
    <view class="wrong-hero">
      <view class="glow" />
      <view>
        <text class="hero-label">REVIEW</text>
        <text class="hero-title">错词本</text>
        <text class="hero-sub">{{ words.length }} 个待复习 · 内容正确度低于设定线自动收录</text>
      </view>
      <view class="hero-badge">{{ words.length }}</view>
    </view>

    <view class="actions">
      <button class="btn btn-plain" @click="onExport">导出</button>
      <button class="btn btn-plain" @click="onImport">导入</button>
    </view>

    <view v-if="words.length" class="pick-bar">
      <text class="pick-label">勾选要重练的单词</text>
      <view class="pick-side">
        <text class="pick-num">已选 {{ selected.length }} / {{ words.length }}</text>
        <text class="pick-link" @click="toggleAll">{{ allPicked ? '取消全选' : '全选' }}</text>
      </view>
    </view>

    <view v-if="words.length" class="card list-card">
      <view v-for="w in words" :key="w.id" class="wrong-block">
        <view class="word-item">
          <view class="pick" :class="{ on: isPicked(w.id) }" @click="togglePick(w.id)">
            <text class="pick-mark">{{ isPicked(w.id) ? '✓' : '' }}</text>
          </view>
          <view class="word-main" @click="togglePick(w.id)">
            <view class="word-line">
              <text class="word">{{ w.word }}</text>
              <text v-if="w.phonetic_us" class="phonetic">{{ w.phonetic_us }}</text>
              <text class="wrong-tag">错 {{ w.wrong_count }} 次</text>
            </view>
            <text class="trans">{{ w.translation }}</text>
            <view class="rec-line">
              <text v-if="history[w.id]?.length" class="rec-last">
                最近 {{ history[w.id][0].score }} 分 · {{ history[w.id][0].modeLabel }} · {{ fmt(history[w.id][0].at) }}
              </text>
              <text v-else class="rec-last">还没有作答记录</text>
              <text v-if="history[w.id]?.length" class="rec-toggle" @click.stop="toggle(w.id)">
                {{ expandedId === w.id ? '收起' : `成绩详情 (${history[w.id].length})` }}
              </text>
            </view>
          </view>
          <button class="btn btn-ghost btn-sm" @click.stop="onMastered(w.id)">已掌握</button>
        </view>

        <view v-if="expandedId === w.id" class="hist">
          <view v-for="a in history[w.id]" :key="a.id" class="hist-item">
            <view class="hist-head">
              <text class="hist-mode">{{ a.modeLabel }}</text>
              <text class="hist-score" :class="scoreClass(a.score)">{{ a.score }} 分</text>
              <text class="hist-time">{{ fmt(a.at) }}</text>
            </view>
            <text class="hist-line">你的作答：{{ a.answer || '（空）' }}</text>
            <text class="hist-line dim">标准答案：{{ a.expected || w.word }}</text>
          </view>
        </view>
      </view>
    </view>
    <view v-else class="card empty-card">
      <view class="empty-mark">✓</view>
      <text class="empty-title">错词本是空的</text>
      <text class="sub">继续保持，练错的词会自动出现在这里</text>
    </view>

    <!-- 底部固定重练条：只练勾选的单词 -->
    <view v-if="words.length" class="drill-bar">
      <view class="drill-head">
        <text class="drill-count">已选 {{ selected.length }} 个单词</text>
        <text class="drill-tip">{{ selected.length ? '只重练这些词' : '先在上方勾选单词' }}</text>
      </view>
      <view class="drill-actions">
        <button class="btn drill-btn" :disabled="!selected.length" @click="onDrill('type')">默写重练</button>
        <button class="btn btn-plain drill-btn" :disabled="!selected.length" @click="onDrill('voice')">语音重练</button>
      </view>
    </view>

    <!-- 导入弹层 -->
    <view v-if="importing" class="mask" @click.self="importing = false">
      <view class="sheet">
        <text class="title">导入词库 JSON</text>
        <textarea class="input" style="height: 320rpx; margin: 20rpx 0" v-model="importText" maxlength="-1"
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
import { computed, ref } from 'vue'
import { listRecords, listWrongWords, markMastered } from '@/services/storage'
import { exportLibrary, importLibraryJson } from '@/services/library-io'
import { fileBackupAvailable, listBackups, readBackup } from '@/services/backup'
import type { PracticeRecord, Word } from '@/services/types'
import { useLibraryStore } from '@/store/library'

interface Attempt {
  id: string
  score: number
  at: number
  modeLabel: string
  answer: string
  expected: string
}

const library = useLibraryStore()
const words = ref<Word[]>([])
const importing = ref(false)
const importText = ref('')
/** word.id → 最近几次作答（含默写），供针对性复习 */
const history = ref<Record<string, Attempt[]>>({})
const expandedId = ref('')
/** 多选：只重练勾选出来的词 */
const selected = ref<string[]>([])
const allPicked = computed(() =>
  words.value.length > 0 && selected.value.length === words.value.length,
)

onShow(async () => { await reload() })

async function reload() {
  words.value = await listWrongWords()
  const entries = await Promise.all(words.value.map(async (w) => {
    const list = (await listRecords(w.id, 6)).filter((r) => r.input_type !== 'mastered')
    return [w.id, list.map(toAttempt)] as const
  }))
  history.value = Object.fromEntries(entries)
  if (expandedId.value && !history.value[expandedId.value]) expandedId.value = ''
  // 已掌握 / 导入后列表会变，选中项只保留仍存在的词
  const alive = new Set(words.value.map((w) => w.id))
  selected.value = selected.value.filter((id) => alive.has(id))
}

function isPicked(id: string) { return selected.value.includes(id) }

function togglePick(id: string) {
  selected.value = isPicked(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
}

function toggleAll() {
  selected.value = allPicked.value ? [] : words.value.map((w) => w.id)
}

/** 记录里的 mode / input_type / detail_json 还原成「哪次、什么方式、多少分、写了什么」 */
function toAttempt(r: PracticeRecord): Attempt {
  let d: { dictation?: boolean; expected?: string; answer?: string } = {}
  try { d = JSON.parse(r.detail_json) as typeof d } catch (_) { d = {} }
  const label = r.mode === '2.1'
    ? '共读'
    : d.dictation
      ? '默写'
      : r.mode === '2.2'
        ? (r.input_type === 'record' ? '中英·语音' : '中英·输入')
        : (r.input_type === 'record' ? '英中·语音' : '英中·输入')
  return {
    id: r.id,
    score: Number(r.score) || 0,
    at: Number(r.created_at) || 0,
    modeLabel: label,
    answer: (r.raw_text || r.asr_text || d.answer || '').trim(),
    expected: (d.expected || '').trim(),
  }
}

function toggle(id: string) {
  expandedId.value = expandedId.value === id ? '' : id
}

function scoreClass(score: number) { return score >= 85 ? 'good' : score >= 60 ? 'mid' : 'low' }

function fmt(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function onMastered(id: string) {
  await markMastered(id)
  await reload()
  await library.refreshUnits()
  if (library.currentUnitId) await library.openUnit(library.currentUnitId)
  uni.showToast({ title: '已移出错词本', icon: 'success' })
}

/**
 * 只练勾选出来的错词（wordIds 精确子集，不再把整个单元拉进来）。
 * type = 默写（自定义键盘），voice = 2.2 语音。
 */
function onDrill(kind: 'type' | 'voice') {
  const picked = words.value.filter((w) => isPicked(w.id))
  if (!picked.length) {
    uni.showToast({ title: '先勾选要重练的单词', icon: 'none' })
    return
  }
  const ids = picked.map((w) => w.id).join(',')
  const unitIds = [...new Set(picked.map((w) => w.unit_id))].join(',')
  const input = kind === 'type' ? '&input=type' : ''
  uni.navigateTo({
    url: `/pages/practice/practice?unitId=${unitIds}&mode=2.2&wordIds=${ids}${input}`,
  })
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
  await reload()
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
.wrong-hero {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 20rpx;
  background: linear-gradient(140deg, #fff7ed 0%, #ffedd5 100%);
  border-radius: 32rpx; padding: 34rpx 30rpx;
  box-shadow: 0 10rpx 30rpx rgba(245, 158, 11, .10);
}
.glow { position: absolute; width: 220rpx; height: 220rpx; border-radius: 50%; right: -70rpx; top: -100rpx; background: rgba(245, 158, 11, .12); }
.hero-label { font-size: 20rpx; letter-spacing: 3rpx; color: #d97706; }
.hero-title { display: block; font-size: 42rpx; font-weight: 700; margin-top: 8rpx; color: #7c3f00; }
.hero-sub { display: block; font-size: 22rpx; color: #a16207; margin-top: 10rpx; line-height: 1.5; }
.hero-badge {
  position: relative; flex-shrink: 0;
  width: 96rpx; height: 96rpx; border-radius: 30rpx;
  background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #fff;
  font-size: 38rpx; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10rpx 24rpx rgba(245, 158, 11, .28);
}

.actions { display: flex; flex-wrap: wrap; gap: 12rpx; margin: 24rpx 0; }
.actions .btn { width: calc(50% - 6rpx); }

/* 多选 */
.pick-bar { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; padding: 0 8rpx 14rpx; }
.pick-label { font-size: 22rpx; color: var(--elr-muted); }
.pick-side { display: flex; align-items: center; gap: 20rpx; }
.pick-num { font-size: 22rpx; color: var(--elr-muted); }
.pick-link { font-size: 23rpx; color: var(--elr-primary-dark); }
.pick {
  width: 46rpx; height: 46rpx; border-radius: 50%; flex-shrink: 0;
  border: 2rpx solid #d3d9e6; background: #fff;
  display: flex; align-items: center; justify-content: center;
}
.pick.on { background: var(--elr-primary); border-color: var(--elr-primary-dark); }
.pick-mark { color: #fff; font-size: 24rpx; font-weight: 700; line-height: 1; }

/* 底部固定重练条 */
.has-drill-bar { padding-bottom: calc(260rpx + env(safe-area-inset-bottom)); }
.drill-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  padding: 16rpx 30rpx calc(16rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, .98);
  border-top-left-radius: 28rpx; border-top-right-radius: 28rpx;
  border-top: 1rpx solid var(--elr-line);
  box-shadow: 0 -10rpx 34rpx rgba(27, 33, 48, .10);
}
.drill-head { display: flex; align-items: baseline; gap: 16rpx; margin-bottom: 12rpx; }
.drill-count { font-size: 26rpx; font-weight: 600; }
.drill-tip { font-size: 21rpx; color: var(--elr-muted); }
.drill-actions { display: flex; gap: 16rpx; }
.drill-btn { flex: 1; padding: 20rpx 0; font-size: 27rpx; }
.drill-btn[disabled] { opacity: .45; }

.list-card { padding: 6rpx 28rpx; }
.wrong-block { border-bottom: 1rpx solid var(--elr-line); }
.wrong-block:last-child { border-bottom: none; }
.word-item { display: flex; align-items: center; gap: 18rpx; padding: 24rpx 0; }
.word-main { flex: 1; min-width: 0; }
.word-line { display: flex; align-items: center; flex-wrap: wrap; gap: 12rpx; }
.word { font-size: 32rpx; font-weight: 600; }
.phonetic { font-size: 24rpx; color: var(--elr-muted); }
.wrong-tag { font-size: 21rpx; color: var(--elr-warn); background: #fff5e6; border-radius: 8rpx; padding: 2rpx 10rpx; }
.trans { display: block; font-size: 27rpx; color: #3d4456; margin-top: 8rpx; }
.rec-line { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-top: 10rpx; }
.rec-last { font-size: 21rpx; color: #aab1c2; }
.rec-toggle { font-size: 21rpx; color: var(--elr-primary-dark); flex-shrink: 0; }

.hist { padding: 4rpx 0 22rpx; }
.hist-item { background: #fffaf5; border-radius: 14rpx; padding: 14rpx 18rpx; margin-top: 10rpx; }
.hist-head { display: flex; align-items: center; gap: 14rpx; }
.hist-mode { font-size: 21rpx; color: #6a7287; background: #fff1e3; border-radius: 8rpx; padding: 2rpx 10rpx; }
.hist-score { font-size: 24rpx; font-weight: 600; }
.hist-score.good { color: #0f9d63; }
.hist-score.mid { color: #b45309; }
.hist-score.low { color: #dc2626; }
.hist-time { font-size: 20rpx; color: #aab1c2; margin-left: auto; }
.hist-line { display: block; font-size: 23rpx; color: #3d4456; margin-top: 8rpx; line-height: 1.5; word-break: break-all; }
.hist-line.dim { color: #8a93a8; }

.empty-card { display: flex; flex-direction: column; align-items: center; padding: 56rpx 40rpx; }
.empty-mark {
  width: 110rpx; height: 110rpx; border-radius: 50%;
  background: #ecfdf5; color: var(--elr-ok); font-size: 46rpx;
  display: flex; align-items: center; justify-content: center;
}
.empty-title { font-size: 30rpx; font-weight: 600; margin: 22rpx 0 8rpx; }

.mask { position: fixed; inset: 0; background: rgba(20, 24, 34, .45); display: flex; align-items: flex-end; z-index: 20; }
.sheet { width: 100%; background: #fff; border-radius: 28rpx 28rpx 0 0; padding: 32rpx 28rpx 60rpx; }
</style>

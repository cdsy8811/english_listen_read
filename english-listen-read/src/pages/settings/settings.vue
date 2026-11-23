<template>
  <view class="page">
    <view class="profile">
      <view class="avatar">设</view>
      <view class="profile-copy">
        <text class="profile-title">偏好设置</text>
        <text class="profile-sub">所有设置只保存在本机，随时可恢复默认</text>
      </view>
    </view>

    <!-- 全局 -->
    <view class="card">
      <view class="group-head">
        <view class="dot blue" />
        <text class="title">全局朗读</text>
      </view>
      <view class="divider" />

      <view class="set-row">
        <view class="set-main">
          <text class="set-label">朗读速度</text>
          <text class="sub">{{ settings.data.speed.toFixed(1) }}×</text>
        </view>
        <slider :value="settings.data.speed" :min="0.5" :max="2" :step="0.1"
          show-value :activeColor="'#f97316'" style="width: 340rpx" @change="onSpeed" />
      </view>
      <view class="set-row">
        <view class="set-main">
          <text class="set-label">英美发音</text>
          <text class="sub">讯飞英文为美音；选 UK 时用系统语音</text>
        </view>
        <picker :range="['US 美音', 'UK 英音']" @change="onAccent">
          <text class="set-value">{{ settings.data.accent === 'US' ? 'US 美音' : 'UK 英音' }} ›</text>
        </picker>
      </view>
      <view class="set-row">
        <view class="set-main">
          <text class="set-label">音量</text>
          <text class="sub">{{ settings.data.volume }}%</text>
        </view>
        <slider :value="settings.data.volume" :min="0" :max="100" :step="5"
          :activeColor="'#f97316'" style="width: 340rpx" @change="onVolume" />
      </view>
      <view class="set-row">
        <text class="set-label">进入练习自动播放</text>
        <switch :checked="settings.data.autoPlay" color="#f97316" @change="onAutoPlay" />
      </view>
    </view>

    <!-- 学习 · 朗读 -->
    <view class="card">
      <view class="group-head">
        <view class="dot green" />
        <text class="title">学习 · 朗读</text>
        <text class="group-tag">2.1</text>
      </view>
      <view class="divider" />
      <view class="set-row">
        <text class="set-label">播放顺序</text>
        <picker :range="playOrderLabels" @change="onPlayOrder">
          <text class="set-value">{{ playOrderLabels[playOrderIndex] }} ›</text>
        </picker>
      </view>
      <view class="set-row">
        <text class="set-label">每条重复次数</text>
        <picker :range="['1 次', '2 次', '3 次']" @change="onRepeat">
          <text class="set-value">{{ settings.data.repeatTimes }} 次 ›</text>
        </picker>
      </view>
      <view class="set-row">
        <view class="set-main">
          <text class="set-label">条目间隔</text>
          <text class="sub">{{ settings.data.itemGapSec.toFixed(1) }} 秒</text>
        </view>
        <slider :value="settings.data.itemGapSec" :min="0" :max="10" :step="0.5"
          :activeColor="'#f97316'" style="width: 340rpx" @change="onGap" />
      </view>
    </view>

    <!-- 中英 / 英中 作答与推进 -->
    <view class="card">
      <view class="group-head">
        <view class="dot orange" />
        <text class="title">中英 / 英中 · 作答与推进</text>
        <text class="group-tag">2.2 / 2.3</text>
      </view>
      <view class="divider" />
      <view class="set-row">
        <text class="set-label">作答方式</text>
        <text class="set-value fixed">输入框 / 按住录音</text>
      </view>
      <view class="set-row">
        <text class="set-label">推进模式</text>
        <picker :range="['提交后进入下一条', '间隔一定时间后进入下一条']" @change="onAdvance">
          <text class="set-value">{{ settings.data.advanceMode === 'submit' ? '提交后' : '定时' }} ›</text>
        </picker>
      </view>
      <view class="set-row" v-if="settings.data.advanceMode === 'timer'">
        <view class="set-main">
          <text class="set-label">等待秒数</text>
          <text class="sub">{{ settings.data.waitSec }} 秒</text>
        </view>
        <slider :value="settings.data.waitSec" :min="1" :max="15" :step="1"
          :activeColor="'#f97316'" style="width: 340rpx" @change="onWait" />
      </view>
      <view class="set-row">
        <text class="set-label">评分严格度</text>
        <picker :range="['宽松', '标准', '严格']" @change="onStrictness">
          <text class="set-value">{{ strictLabel }} ›</text>
        </picker>
      </view>
      <view class="set-row">
        <view class="set-main">
          <text class="set-label">错词本收录线</text>
          <text class="sub">低于 {{ settings.data.wrongThreshold }} 分自动收录</text>
        </view>
        <slider :value="settings.data.wrongThreshold" :min="0" :max="100" :step="10"
          :activeColor="'#f97316'" style="width: 340rpx" @change="onThreshold" />
      </view>
    </view>

    <!-- 词库备份 -->
    <view class="card">
      <view class="group-head">
        <view class="dot cyan" />
        <text class="title">词库备份</text>
      </view>
      <view class="divider" />
      <view class="set-row" @click="onExport">
        <view class="set-main">
          <text class="set-label">导出备份</text>
          <text class="sub">保存 JSON 到本机并复制到剪贴板</text>
        </view>
        <text class="set-value">导出 ›</text>
      </view>
      <view class="set-row" @click="onShare">
        <view class="set-main">
          <text class="set-label">分享备份</text>
          <text class="sub">调起系统分享，把 JSON 直接发到另一台手机</text>
        </view>
        <text class="set-value">分享 ›</text>
      </view>
      <view class="set-row" @click="onImport">
        <view class="set-main">
          <text class="set-label">导入备份</text>
          <text class="sub">粘贴 JSON，或从手机文件 / App 备份目录选择</text>
        </view>
        <text class="set-value">导入 ›</text>
      </view>

      <view class="divider" />
      <view class="set-row" @click="onClearLibrary">
        <view class="set-main">
          <text class="set-label danger">清空词库</text>
          <text class="sub">删除全部单元、词条与练习记录（错词本一并清空），设置与音频缓存保留</text>
        </view>
        <text class="set-value danger">清空 ›</text>
      </view>
    </view>

    <!-- 朗读缓存 -->
    <view class="card">
      <view class="group-head">
        <view class="dot purple" />
        <text class="title">朗读缓存</text>
      </view>
      <view class="divider" />
      <view class="set-row">
        <view class="set-main">
          <text class="set-label">已缓存朗读</text>
          <text class="sub">{{ cacheSummary }}</text>
        </view>
        <text class="set-value">上限 {{ cacheLimitMb }} MB</text>
      </view>
      <view class="set-row" @click="onClearCache">
        <view class="set-main">
          <text class="set-label danger">清理朗读缓存</text>
          <text class="sub">只删本地音频，词库 / 记录 / 设置保留；下次朗读重新合成</text>
        </view>
        <text class="set-value danger">清理 ›</text>
      </view>
      <text class="sub note">命中缓存不发请求、不计费；超过上限时按最久未播放淘汰</text>
    </view>

    <!-- 运行状态 -->
    <view class="card">
      <view class="group-head">
        <view class="dot purple" />
        <text class="title">运行状态</text>
      </view>
      <view class="divider" />
      <view class="set-row">
        <text class="set-label">凭据注入</text>
        <text class="set-value" :style="{ color: cloudReady ? '#22c55e' : '#f59e0b' }">
          {{ cloudReady ? (cfg.ready ? '已就绪（直连讯飞）' : '浏览器预览（走本机代理）') : '未就绪（本地功能可用）' }}
        </text>
      </view>
      <view class="set-row" @click="openLogs">
        <view class="set-main">
          <text class="set-label">排障日志</text>
          <text class="sub">导入 / 分享 / 网络等失败详情，可复制</text>
        </view>
        <text class="set-value">查看 ›</text>
      </view>
      <text class="sub note">方案 C：App 端自签名直连，无需电脑 / 服务器。密钥只在本机 .env.local 与 APK 中。</text>
      <button class="btn btn-plain reset-btn" @click="onReset">恢复默认设置</button>
    </view>

    <view class="version">橙子英语 · 离线优先</view>

    <!-- 导入弹层 -->
    <view v-if="importing" class="mask" @click.self="importing = false">
      <view class="sheet">
        <text class="sheet-title">导入词库 JSON</text>
        <textarea class="sheet-input" v-model="importText" maxlength="-1" placeholder="粘贴本应用导出的 JSON" />
        <view class="sheet-row">
          <button class="btn btn-plain" @click="importing = false">取消</button>
          <button class="btn" @click="doImport">导入</button>
        </view>
        <button v-if="filePickerAvailable()" class="btn btn-ghost" style="margin-top: 20rpx" @click="onImportFromSystemFile">
          从手机文件选择（.json）
        </button>
        <button v-if="fileBackupAvailable()" class="btn btn-ghost" style="margin-top: 16rpx" @click="onImportFromFile">
          从 App 备份目录选择
        </button>
      </view>
    </view>

    <!-- 排障日志弹层 -->
    <view v-if="logOpen" class="mask" @click.self="logOpen = false">
      <view class="sheet">
        <view class="log-head">
          <text class="sheet-title">排障日志</text>
          <text class="log-tool" @click="copyLogs">复制全部</text>
          <text class="log-tool" @click="clearLogs">清空</text>
          <text class="log-tool" @click="logOpen = false">关闭</text>
        </view>
        <scroll-view class="log-box" scroll-y>
          <view v-for="(l, i) in logLines" :key="i">
            <text class="log-line">{{ l }}</text>
          </view>
          <text v-if="!logLines.length" class="log-line">（暂无日志）</text>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useSettingsStore } from '@/store/settings'
import { useLibraryStore } from '@/store/library'
import { configSummary, cloudAvailable } from '@/api/runtime-config'
import { exportLibrary, importLibraryJson } from '@/services/library-io'
import { fileBackupAvailable, listBackups, readBackup } from '@/services/backup'
import { clearLibrary } from '@/services/storage'
import { cacheStats, clearAudioCache, formatBytes, CACHE_LIMIT_BYTES } from '@/services/tts-cache'
import { clearLogHistory, logHistory, logger } from '@/utils/log'
import { nativeFilePath } from '@/utils/plus-io'
import { filePickerAvailable, pickTextFile } from '@/utils/file-picker'
import { fileShareAvailable, shareFile } from '@/utils/share-file'
import type { ExportOutcome } from '@/services/library-io'
import type { Accent, AdvanceMode, PlayOrder, Strictness } from '@/services/types'

const settings = useSettingsStore()
const library = useLibraryStore()
void settings.load()
const cfg = ref(configSummary())
const cloudReady = cloudAvailable()
const importing = ref(false)
const importText = ref('')
const logOpen = ref(false)
const logLines = ref<string[]>([])
const cache = ref<{ count: number; bytes: number; hit: number; miss: number }>({ count: 0, bytes: 0, hit: 0, miss: 0 })
const cacheLimitMb = Math.round(CACHE_LIMIT_BYTES / 1048576)
const cacheSummary = computed(() => {
  const { count, bytes, hit, miss } = cache.value
  const total = hit + miss
  const rate = total ? Math.round((hit / total) * 100) : 0
  return `${count} 条 · ${formatBytes(bytes)} · 本次命中 ${rate}%`
})

async function refreshCacheInfo() {
  cache.value = await cacheStats()
}

onShow(() => { void settings.load(); void refreshCacheInfo() })

const playOrderLabels = ['英 → 中', '中 → 英', '仅英文']
const playOrderIndex = computed(() => ['en-zh', 'zh-en', 'en-only'].indexOf(settings.data.playOrder))
const strictLabel = computed(() => ({ loose: '宽松', normal: '标准', strict: '严格' })[settings.data.strictness])

const onSpeed = (e: { detail: { value: number } }) => void settings.set('speed', Number(e.detail.value.toFixed(1)))
const onVolume = (e: { detail: { value: number } }) => void settings.set('volume', e.detail.value)
const onGap = (e: { detail: { value: number } }) => void settings.set('itemGapSec', Number(e.detail.value.toFixed(1)))
const onWait = (e: { detail: { value: number } }) => void settings.set('waitSec', e.detail.value)
const onThreshold = (e: { detail: { value: number } }) => void settings.set('wrongThreshold', e.detail.value)
// switch 的 change 事件在 vue-tsc 里被解析为 DOM 原生事件，用 any 承接 uni-app 的 detail
const onAutoPlay = (e: any) => void settings.set('autoPlay', e.detail.value as boolean)
const onAccent = (e: { detail: { value: number } }) => void settings.set('accent', (['US', 'UK'] as Accent[])[e.detail.value])
const onAdvance = (e: { detail: { value: number } }) => void settings.set('advanceMode', (['submit', 'timer'] as AdvanceMode[])[e.detail.value])
const onPlayOrder = (e: { detail: { value: number } }) => void settings.set('playOrder', (['en-zh', 'zh-en', 'en-only'] as PlayOrder[])[e.detail.value])
const onRepeat = (e: { detail: { value: number } }) => void settings.set('repeatTimes', e.detail.value + 1)
const onStrictness = (e: { detail: { value: number } }) => void settings.set('strictness', (['loose', 'normal', 'strict'] as Strictness[])[e.detail.value])

function onReset() {
  uni.showModal({
    title: '恢复默认设置', content: '只重置设置项，不会删除词库与练习记录。',
    success: (r) => { if (r.confirm) void settings.reset() },
  })
}

/* ---------------- 朗读缓存（省钱：命中不发请求） ---------------- */

function onClearCache() {
  uni.showModal({
    title: '清理朗读缓存',
    content: '将删除本机已缓存的全部朗读音频，之后每句都要重新合成（会计费）。词库、练习记录与设置不受影响。',
    confirmText: '清理',
    confirmColor: '#e11d48',
    success: async (r) => {
      if (!r.confirm) return
      uni.showLoading({ title: '正在清理', mask: true })
      try {
        const n = await clearAudioCache()
        await refreshCacheInfo()
        uni.hideLoading()
        uni.showToast({ title: n ? `已清理 ${n} 条` : '没有可清理的缓存', icon: 'none' })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: (e as Error).message || '清理失败', icon: 'none' })
      }
    },
  })
}

/* ---------------- 词库备份（纯本地，无账号无同步） ---------------- */

/** 复制 JSON 到剪贴板；失败不阻塞导出流程（文件仍然已落盘）。 */
function copyJson(json: string): Promise<void> {
  return new Promise((resolve) => uni.setClipboardData({
    data: json, success: () => resolve(), fail: () => resolve(),
  }))
}

/** App 端调系统分享面板发送备份文件；平台不支持或失败时退回复制 JSON。 */
async function shareExport(r: ExportOutcome) {
  if (fileShareAvailable() && r.path) {
    try {
      await shareFile(nativeFilePath(r.path), { title: '分享词库备份' })
      return
    } catch (_) { /* 走下面的剪贴板兜底 */ }
  }
  await copyJson(r.json)
  uni.showToast({ title: '当前环境无法系统分享，JSON 已复制', icon: 'none' })
}

async function onExport() {
  try {
    const r = await exportLibrary()
    await copyJson(r.json)
    const canShare = fileShareAvailable() && !!r.path
    uni.showModal({
      title: '导出完成',
      content: r.path
        ? `已保存备份：${r.path}\n共 ${r.units} 个单元 / ${r.words} 个词条，JSON 也已复制到剪贴板。`
        : `共 ${r.units} 个单元 / ${r.words} 个词条，JSON 已复制到剪贴板，请粘贴保存。`,
      showCancel: canShare,
      confirmText: canShare ? '分享到另一台手机' : '知道了',
      cancelText: '完成',
      success: (m) => { if (canShare && m.confirm) void shareExport(r) },
    })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '导出失败', icon: 'none' })
  }
}

/** 分享备份：先导出（拿到最新 JSON 和文件路径），再交给系统分享。 */
async function onShare() {
  uni.showLoading({ title: '正在导出', mask: true })
  try {
    const r = await exportLibrary()
    uni.hideLoading()
    await shareExport(r)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message || '导出失败', icon: 'none' })
  }
}

function onImport() { importText.value = ''; importing.value = true }

/** 清空词库：不可恢复，先提示导出备份，再二次确认 */
function onClearLibrary() {
  uni.showModal({
    title: '清空词库',
    content: '将删除全部单元、词条与练习记录（错词本一并清空），删除后不可恢复。建议先「导出备份」，确定继续？',
    confirmText: '清空',
    confirmColor: '#e11d48',
    success: async (r) => {
      if (!r.confirm) return
      uni.showLoading({ title: '正在清空', mask: true })
      try {
        const res = await clearLibrary()
        library.clearAll()
        uni.hideLoading()
        uni.showModal({
          title: '已清空',
          content: `删除 ${res.units} 个单元、${res.words} 个词条、${res.records} 条练习记录。`,
          showCancel: false,
        })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: (e as Error).message || '清空失败', icon: 'none' })
      }
    },
  })
}

async function applyImport(text: string) {
  const r = await importLibraryJson(text)
  importing.value = false
  uni.showToast({ title: `导入 ${r.units} 单元 / ${r.words} 词`, icon: 'success' })
}

/** 导入失败：写日志 + 用弹窗展示完整原因（toast 一闪而过，容易看不清）。 */
function showImportError(e: unknown, from: 'paste' | 'file' | 'backup') {
  const msg = (e as Error)?.message || '导入失败'
  logger.warn('settings.import.fail', { from, msg })
  uni.showModal({
    title: '导入失败',
    content: `${msg}\n\n失败过程已写入排障日志，可查看后复制。`,
    confirmText: '查看日志',
    cancelText: '关闭',
    success: (r) => { if (r.confirm) openLogs() },
  })
}

async function doImport() {
  try { await applyImport(importText.value) }
  catch (e) { showImportError(e, 'paste') }
}

async function onImportFromFile() {
  try {
    const files = await listBackups()
    if (!files.length) { uni.showToast({ title: '还没有本地备份文件', icon: 'none' }); return }
    uni.showActionSheet({
      itemList: files.slice(0, 8).map((f) => f.name),
      success: async (r) => {
        try { await applyImport(await readBackup(files[r.tapIndex].url)) }
        catch (e) { showImportError(e, 'backup') }
      },
    })
  } catch (e) {
    showImportError(e, 'backup')
  }
}

/** 系统文件选择器导入：回填 textarea（格式错误时可手动检查）后走同一套校验。 */
async function onImportFromSystemFile() {
  try {
    const picked = await pickTextFile()
    importText.value = picked.text
    await applyImport(picked.text)
  } catch (e) {
    const msg = (e as Error).message || '读取文件失败'
    if (msg === '已取消选择') return
    showImportError(e, 'file')
  }
}

/* ---------------- 排障日志（导入 / 分享 / 网络失败详情） ---------------- */

/** 过滤逐条 SQL 噪音，只保留最近 200 行便于在手机上查看。 */
function refreshLogs() {
  logLines.value = logHistory()
    .filter((l) => !/\[db\.(exec|select|tx)\]/.test(l))
    .slice(-200)
}

function openLogs() {
  refreshLogs()
  logOpen.value = true
}

function copyLogs() {
  refreshLogs()
  uni.setClipboardData({ data: logLines.value.join('\n') })
}

function clearLogs() {
  clearLogHistory()
  logLines.value = []
}
</script>

<style scoped>
.profile { display: flex; align-items: center; gap: 22rpx; padding: 12rpx 8rpx 28rpx; }
.avatar {
  width: 92rpx; height: 92rpx; border-radius: 30rpx;
  background: linear-gradient(135deg, #fdba74, #f97316); color: #fff;
  font-size: 38rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10rpx 24rpx rgba(249, 115, 22, .25);
}
.profile-copy { display: flex; flex-direction: column; }
.profile-title { font-size: 36rpx; font-weight: 700; }
.profile-sub { font-size: 23rpx; color: var(--elr-muted); margin-top: 6rpx; }

.group-head { display: flex; align-items: center; gap: 14rpx; }
.dot { width: 14rpx; height: 14rpx; border-radius: 50%; }
.dot.blue { background: #f97316; }
.dot.green { background: #10b981; }
.dot.orange { background: #f59e0b; }
.dot.purple { background: #8b5cf6; }
.dot.cyan { background: #0ea5e9; }
.group-tag { font-size: 20rpx; color: var(--elr-muted); background: #f3f5fb; border-radius: 999rpx; padding: 3rpx 12rpx; }

.set-row { display: flex; align-items: center; justify-content: space-between; min-height: 92rpx; gap: 20rpx; }
.set-main { display: flex; flex-direction: column; }
.set-label { font-size: 28rpx; }
.set-label.danger { color: var(--elr-err); }
.set-value { font-size: 27rpx; color: var(--elr-primary-dark); }
.set-value.danger { color: var(--elr-err); }
/* 不可选项（作答方式固定为输入框 + 按住录音并存）：不做成主色，避免看成可点 */
.set-value.fixed { color: var(--elr-muted); font-size: 25rpx; }
.note { display: block; margin-top: 8rpx; line-height: 1.6; }
.reset-btn { width: 100%; margin-top: 24rpx; }
.version { text-align: center; font-size: 21rpx; color: #b3bacb; padding: 30rpx 0 10rpx; }

.mask { position: fixed; inset: 0; background: rgba(20, 24, 34, .45); display: flex; align-items: flex-end; z-index: 20; }
/* 底部弹层：预留原生 / H5 标签栏的高度，避免按钮被 tabbar 盖住点不到 */
.sheet { width: 100%; max-height: 88vh; overflow-y: auto; background: #fff; border-radius: 28rpx 28rpx 0 0; padding: 32rpx 28rpx 180rpx; }
.sheet-title { font-size: 32rpx; font-weight: 600; }
.sheet-input {
  width: 100%; height: 320rpx; margin: 20rpx 0; padding: 20rpx;
  background: #fdf7f2; border-radius: 16rpx; font-size: 25rpx; box-sizing: border-box;
}
.sheet-row { display: flex; gap: 16rpx; }
.sheet-row .btn { flex: 1; }

.log-head { display: flex; align-items: center; gap: 20rpx; }
.log-head .sheet-title { flex: 1; }
.log-tool { font-size: 24rpx; color: var(--elr-primary-dark); }
.log-box {
  height: 620rpx; margin-top: 20rpx; padding: 16rpx;
  background: #fdf7f2; border-radius: 16rpx; box-sizing: border-box;
}
.log-line {
  display: block; font-size: 22rpx; line-height: 1.65; color: #46506a;
  word-break: break-all;
}
</style>

<template>
  <view class="page">
    <view class="card">
      <text class="title">拍照入库</text>
      <view class="divider" />
      <text class="sub">拍下印刷体单词表（英文单词 + 音标 + 中文释义），自动识别成可编辑词条。</text>
      <view style="height: 24rpx" />
      <button class="btn" @click="onCamera">拍照识别</button>
      <button class="btn btn-plain" style="margin-top: 20rpx" @click="onAlbum">从相册选图</button>
      <view class="divider" />
      <text class="sub">没网或识别失败？可以直接粘贴单词表文本，本地解析后同样能进校对页。</text>
      <view class="ai-row">
        <view class="ai-main">
          <text class="ai-label">AI 整理并分单元入库</text>
          <text class="ai-hint">开启后可一次粘贴整本书：按 Unit / 第 N 单元标题切分，逐段交给 AI 抽取词条并直接入库（同名单元自动追加、重复词条跳过）。需联网，H5 预览不可用。</text>
        </view>
        <switch class="ai-switch" :checked="useAi" color="#f97316" @change="onAiToggle" />
      </view>
      <textarea class="input" style="height: 420rpx; margin-top: 16rpx" v-model="manualText" maxlength="-1"
        placeholder="示例：abandon /əˈbændən/ v. 放弃；抛弃" />
      <button class="btn btn-ghost" style="margin-top: 16rpx" :disabled="busy" @click="onManual">
        {{ useAi ? 'AI 整理并入库' : '用文本生成词条' }}
      </button>
    </view>

    <view class="card">
      <text class="title">识别流程</text>
      <view class="divider" />
      <text class="sub">1. 图片压缩到 ≤4M → 2. 讯飞通用文档识别 → 3. 只取识别结果的 markdown → 4. Spark X2.6 抽取词条（音标按单词重新生成）→ 5. 人工校对 → 6. 本地入库</text>
      <view class="divider" />
      <text class="sub">方案 C：App 端自签名直连讯飞，不需要电脑或服务器；断网时可用上方文本框降级。</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { chooseImage, prepareImage } from '@/utils/image'
import { requestPermission } from '@/utils/permission'
import { useCaptureStore } from '@/store/capture'
import { useLibraryStore } from '@/store/library'
import { parsePlainTextDrafts } from '@/services/parser-text'
import { splitUnitSections } from '@/services/parser'
import { extractWords } from '@/services'
import { createUnit, draftToWord, listUnits, listWords, saveWords } from '@/services/storage'
import { cloudAvailable } from '@/api/runtime-config'
import { errText, logger } from '@/utils/log'
import type { WordDraft } from '@/services/types'

const capture = useCaptureStore()
const library = useLibraryStore()
const manualText = ref('')
const busy = ref(false)
/** 文本导入：开启后走 AI 分单元抽取并直接入库（关闭时仍走本地行解析 + 校对页） */
const useAi = ref(false)

function onAiToggle(e: any) {
  useAi.value = !!e.detail.value
  logger.debug('capture.ai.toggle', { on: useAi.value })
}

async function pick(source: 'camera' | 'album') {
  if (busy.value) return
  busy.value = true
  uni.showLoading({ title: '正在准备图片' })
  try {
    const granted = await requestPermission(source === 'camera' ? 'camera' : 'image')
    if (!granted) {
      uni.hideLoading()
      uni.showToast({ title: '没有相机 / 相册权限，可用下方文本框录入', icon: 'none' })
      return
    }
    const path = await chooseImage(source)
    const payload = await prepareImage(path)
    capture.setImage(payload, path)
    uni.hideLoading()
    uni.navigateTo({ url: '/pages/review/review' })
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message || '图片处理失败', icon: 'none' })
  } finally {
    busy.value = false
  }
}

function onCamera() { void pick('camera') }
function onAlbum() { void pick('album') }

function onManual() {
  if (useAi.value) { void importByAi(); return }
  const drafts = parsePlainTextDrafts(manualText.value)
  if (!drafts.length) {
    uni.showToast({ title: '没解析出词条，请检查每行是否含英文单词和中文释义', icon: 'none' })
    return
  }
  capture.setManual(manualText.value)
  capture.drafts = drafts
  capture.markdown = manualText.value
  uni.navigateTo({ url: '/pages/review/review?local=1' })
}

/**
 * AI 分单元入库：整本书文本先按 Unit 标题在本地切段（避免超上下文 / 被截断），
 * 逐段交给 X2.6 抽取 → 按段标题复用或新建单元 → 直接写库，不再经过校对页。
 */
async function importByAi() {
  const text = manualText.value.trim()
  if (!text) {
    uni.showToast({ title: '请先粘贴整本书的单词文本', icon: 'none' })
    return
  }
  if (busy.value) return
  if (!cloudAvailable()) {
    uni.showToast({ title: 'AI 整理需联网且在 App 内使用，H5 预览不支持', icon: 'none' })
    return
  }

  const sections = splitUnitSections(text)
  if (!sections.length) {
    uni.showToast({ title: '没找到可解析的文本', icon: 'none' })
    return
  }
  // 整本书会切出很多段，一段一次云调用：先让用户确认耗时与额度消耗
  if (sections.length > 20) {
    const go = await new Promise<boolean>((resolve) => {
      uni.showModal({
        title: '文本较长',
        content: `将按单元分 ${sections.length} 段逐段调用 AI，可能需要几分钟并消耗较多额度，继续吗？`,
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })
    if (!go) return
  }

  busy.value = true
  let units = 0
  let words = 0
  let skipped = 0
  let failed = 0
  logger.info('capture.ai.start', { chars: text.length, sections: sections.length })
  uni.showLoading({ title: `AI 整理中 0/${sections.length}`, mask: true })
  try {
    const existing = await listUnits()
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i]
      uni.showLoading({ title: `AI 整理中 ${i + 1}/${sections.length}`, mask: true })
      let drafts: WordDraft[]
      try {
        drafts = await extractWords(sec.text)
      } catch (e) {
        failed++
        logger.warn('capture.ai.section.fail', { index: i, title: sec.title, msg: errText(e), code: (e as { code?: number }).code })
        // 平台不支持 / 凭据缺失这类错误整批都会失败，没必要继续跑完所有段
        if ((e as { code?: number }).code === -1) throw e
        continue
      }
      if (!drafts.length) { skipped++; continue }

      // 同名单元复用：重复导入同一本书时不会堆出一串同名单元
      const title = sec.title.trim() || '未命名单元'
      let unit = existing.find((u) => u.title === title)
      if (!unit) {
        unit = await createUnit(title)
        existing.push(unit)
      }
      const have = await listWords(unit.id)
      const seen = new Set(have.map((w) => w.word.trim().toLowerCase()))
      const fresh = drafts.filter((d) => !seen.has(d.word.trim().toLowerCase()))
      skipped += drafts.length - fresh.length
      if (!fresh.length) continue
      const sortStart = have.length ? Math.max(0, ...have.map((w) => Number(w.sort) || 0)) + 1 : 0
      await saveWords(fresh.map((d, k) => draftToWord(d, unit.id, sortStart + k)))
      units++
      words += fresh.length
      logger.info('capture.ai.unit', { index: i, title, added: fresh.length, total: have.length + fresh.length })
    }

    await library.refreshUnits()
    uni.hideLoading()
    logger.info('capture.ai.done', { units, words, skipped, failed })
    const parts = [`${units} 个单元`, `${words} 个词条`]
    if (skipped) parts.push(`跳过 ${skipped} 段/重复词`)
    if (failed) parts.push(`${failed} 段失败`)
    if (!words) {
      uni.showToast({ title: '没有新增词条，请检查文本格式或网络', icon: 'none' })
      return
    }
    uni.showModal({
      title: '已按单元入库',
      content: parts.join('，'),
      showCancel: false,
      success: () => uni.switchTab({ url: '/pages/index/index' }),
    })
  } catch (e) {
    uni.hideLoading()
    logger.error('capture.ai.fail', { msg: errText(e), code: (e as { code?: number }).code })
    uni.showToast({ title: errText(e) || 'AI 整理失败，请重试', icon: 'none' })
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.ai-row {
  display: flex; align-items: center; gap: 16rpx;
  background: #faf5f0; border-radius: 16rpx; padding: 20rpx 22rpx; margin-top: 20rpx;
}
.ai-main { flex: 1; min-width: 0; }
.ai-label { display: block; font-size: 27rpx; font-weight: 600; }
.ai-hint { display: block; font-size: 22rpx; color: var(--elr-muted); line-height: 1.5; margin-top: 6rpx; }
.ai-switch { flex-shrink: 0; }
</style>

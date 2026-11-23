<template>
  <view class="page compose-page">
    <view class="card">
      <text class="title">手工添加短文</text>
      <text class="sub">直接输入或粘贴英文正文，提交后自动按句切分；不走拍照识别，离线也能添加。</text>
      <view class="divider" />

      <text class="label">名称</text>
      <input
        class="input"
        :value="title"
        maxlength="40"
        :disabled="busy"
        placeholder="可选，默认取第一句开头"
        @input="onTitle"
      />

      <view class="row content-head">
        <text class="label">内容</text>
        <text class="counter">{{ content.length }} 字 · 约 {{ previewCount }} 句</text>
      </view>
      <textarea
        class="input body-input"
        :value="content"
        maxlength="4000"
        :disabled="busy"
        placeholder="粘贴课文或短文段落，例如：The little girl walked to school. 小女孩走路去学校。"
        @input="onContent"
      />
      <text class="sub hint">提交时会联网调用 AI 逐句翻译成中文；断网时先保存英文，之后可在学习页补中文。行内括号注释、页码、页眉会被清掉，一次最多 60 句。</text>

      <button class="btn submit-btn" :disabled="busy" @click="onSubmit">
        {{ busy ? '正在保存…' : '提交并开始跟读' }}
      </button>
      <button class="btn btn-plain submit-btn" :disabled="busy" @click="onCancel">取消</button>
    </view>

    <view v-if="preview.sentences.length" class="card preview-card">
      <text class="title">预览</text>
      <text class="sub">共 {{ preview.sentences.length }} 句 · 提交后自动生成逐句中文翻译</text>
      <view v-for="(s, i) in preview.sentences.slice(0, 3)" :key="i" class="preview-item">
        <text class="preview-line">{{ s }}</text>
      </view>
      <text v-if="preview.sentences.length > 3" class="sub">…</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { createArticle } from '@/services/storage'
import { fallbackTitle, markdownToSentences } from '@/services/passage'
import { translateSentences } from '@/services/passage-translate'
import { cloudAvailable } from '@/api/runtime-config'
import { errText, logger } from '@/utils/log'

const title = ref('')
const content = ref('')
const busy = ref(false)

/** 边输边预览：本地切句，所见即所得；中文译文在提交时才由模型生成。 */
const preview = computed(() => {
  if (!content.value.trim()) return { sentences: [] as string[] }
  try {
    return { sentences: markdownToSentences(content.value) }
  } catch {
    return { sentences: [] as string[] }
  }
})
const previewCount = computed(() => preview.value.sentences.length)

function onTitle(e: any) {
  title.value = e.detail.value as string
}

function onContent(e: any) {
  content.value = e.detail.value as string
}

async function onSubmit() {
  if (busy.value) return
  const text = content.value.trim()
  if (!text) {
    uni.showToast({ title: '先输入短文内容', icon: 'none' })
    return
  }
  const sentences = markdownToSentences(text)
  if (!sentences.length) {
    uni.showToast({ title: '没有找到英文句子，请检查内容', icon: 'none' })
    return
  }
  busy.value = true
  // 先逐句翻译（联网）：失败不阻塞入库，学习页还能再补
  let translations: string[] = []
  let zhFailed = false
  if (cloudAvailable()) {
    uni.showLoading({ title: '正在翻译中文', mask: true })
    try {
      translations = await translateSentences(sentences)
    } catch (e) {
      zhFailed = true
      logger.warn('page.read.manual.translate.fail', { msg: errText(e) })
    }
  } else {
    zhFailed = true
    logger.warn('page.read.manual.translate.offline', { sentences: sentences.length })
  }

  uni.showLoading({ title: '正在保存', mask: true })
  try {
    const article = await createArticle({
      title: title.value.trim() || fallbackTitle(sentences),
      sentences,
      translations,
    })
    uni.hideLoading()
    logger.info('page.read.manual.created', {
      sentences: article.sentences.length,
      translated: article.translations.filter(Boolean).length,
    })
    uni.showToast({
      title: zhFailed ? '已保存，中文翻译可稍后在学习页补' : '已添加',
      icon: zhFailed ? 'none' : 'success',
    })
    // 回到跟读列表（onShow 会刷新，新文章排最前），由用户点开开始跟读。
    // 不用 redirectTo 直接跳练习页：H5 预览会把当前页留在浏览器历史里，返回时又跳回填表页。
    uni.navigateBack({
      delta: 1,
      fail: () => uni.redirectTo({ url: '/pages/read/read' }),
    })
  } catch (e) {
    uni.hideLoading()
    logger.error('page.read.manual.fail', { msg: errText(e) })
    uni.showToast({ title: errText(e) || '保存失败', icon: 'none' })
  } finally {
    busy.value = false
  }
}

function onCancel() {
  uni.navigateBack()
}
</script>

<style scoped>
.compose-page { padding-top: 24rpx; }
.compose-page .title { display: block; }
.compose-page .sub { display: block; margin-top: 10rpx; line-height: 1.6; }
.label { font-size: 26rpx; color: var(--elr-muted); }
.content-head { margin-top: 24rpx; }
.counter { font-size: 22rpx; color: var(--elr-muted); }
.body-input {
  display: block;
  width: 100%;
  height: 460rpx;
  margin-top: 12rpx;
}
.hint { display: block; margin-top: 12rpx; line-height: 1.6; }
.submit-btn { width: 100%; margin-top: 28rpx; }
.submit-btn + .submit-btn { margin-top: 16rpx; }
.preview-card { margin-top: 4rpx; }
.preview-item { margin-top: 12rpx; }
.preview-line {
  display: block;
  font-size: 28rpx; line-height: 1.6; color: var(--elr-text);
  background: #faf5f0; border-radius: 14rpx; padding: 18rpx 20rpx;
}
</style>

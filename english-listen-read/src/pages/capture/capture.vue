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
      <textarea class="input" style="height: 180rpx; margin-top: 16rpx" v-model="manualText"
        placeholder="示例：abandon /əˈbændən/ v. 放弃；抛弃" />
      <button class="btn btn-ghost" style="margin-top: 16rpx" @click="onManual">用文本生成词条</button>
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
import { parsePlainTextDrafts } from '@/services/parser-text'

const capture = useCaptureStore()
const manualText = ref('')
const busy = ref(false)

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
</script>

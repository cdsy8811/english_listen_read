import { defineStore } from 'pinia'
import type { ImagePayload } from '@/utils/image'
import type { WordDraft } from '@/services/types'

/** 拍照 → 校对页之间传递图片 / 草稿（避免把大 base64 塞进 URL 参数）。 */
export const useCaptureStore = defineStore('capture', {
  state: () => ({
    image: null as ImagePayload | null,
    markdown: '' as string,
    drafts: [] as WordDraft[],
    unitTitle: '' as string,
    sourceImgPath: '' as string,
  }),
  actions: {
    setImage(p: ImagePayload, sourcePath: string) {
      this.image = p
      this.sourceImgPath = sourcePath
      this.markdown = ''
      this.drafts = []
      this.unitTitle = `拍照词库 ${new Date().toLocaleDateString('zh-CN')}`
    },
    setManual(markdown: string) {
      this.image = null
      this.markdown = markdown
      this.drafts = []
      this.unitTitle = `手写词库 ${new Date().toLocaleDateString('zh-CN')}`
    },
    clear() {
      this.image = null; this.markdown = ''; this.drafts = []; this.sourceImgPath = ''
    },
  },
})

<template>
  <view class="editor">
    <view class="row" style="margin-bottom: 20rpx">
      <text class="title">{{ isNew ? '新增词条' : '编辑词条' }}</text>
      <text class="sub" @click="$emit('cancel')">取消</text>
    </view>
    <view class="field">
      <text class="label">英文单词</text>
      <input class="input" v-model="draft.word" placeholder="如 abandon" :maxlength="80" />
    </view>
    <view class="field">
      <text class="label">IPA 音标（美音）</text>
      <input class="input" v-model="draft.phonetic" placeholder="如 /əˈbændən/（可留空，稍后重生成）" :maxlength="80" />
    </view>
    <view class="field">
      <text class="label">词性</text>
      <input class="input" v-model="draft.pos" placeholder="如 v. / n. / adj." :maxlength="20" />
    </view>
    <view class="field">
      <text class="label">中文释义</text>
      <textarea class="input" style="height: 140rpx" v-model="draft.translation" placeholder="如 放弃；抛弃" :maxlength="120" />
    </view>
    <view class="field">
      <text class="label">例句（可选）</text>
      <textarea class="input" style="height: 160rpx" v-model="example" placeholder="可留空" :maxlength="200" />
    </view>
    <view class="row" style="margin-top: 24rpx; gap: 16rpx">
      <button class="btn btn-plain" style="flex: 1" @click="$emit('cancel')">取消</button>
      <button class="btn" style="flex: 1" @click="submit">保存</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { WordDraft } from '@/services/types'

const props = defineProps<{ value?: WordDraft; isNew?: boolean }>()
const emit = defineEmits<{ (e: 'save', v: WordDraft): void; (e: 'cancel'): void }>()

const blank = (): WordDraft => ({ word: '', phonetic: '', pos: '', translation: '', example: '' })
const draft = reactive<WordDraft>({ ...(props.value || blank()) })
const example = ref(draft.example || '')

watch(() => props.value, (v) => {
  Object.assign(draft, v || blank())
  example.value = draft.example || ''
})

function submit() {
  if (!draft.word.trim()) {
    uni.showToast({ title: '请填写英文单词', icon: 'none' })
    return
  }
  emit('save', { ...draft, word: draft.word.trim(), example: example.value.trim() })
}
</script>

<style scoped>
.editor { padding: 8rpx 0; }
.field { margin-bottom: 20rpx; }
.label { display: block; font-size: 26rpx; color: var(--elr-muted); margin-bottom: 10rpx; }
</style>

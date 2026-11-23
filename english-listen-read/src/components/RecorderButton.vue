<template>
  <view class="recorder">
    <view
      class="rec-circle"
      :class="{ recording, muted: disabled || busy }"
      @touchstart.stop.prevent="onTouchStart"
      @touchend.stop.prevent="onTouchEnd"
      @touchcancel.stop.prevent="onPressEnd"
      @mousedown.stop.prevent="onMouseDown"
      @mouseup.stop.prevent="onPressEnd"
      @mouseleave="onPressEnd"
    >
      <view class="mic">
        <view class="mic-cap" />
        <view class="mic-arc" />
        <view class="mic-stem" />
      </view>
      <text class="rec-state">{{ busy ? '处理中' : recording ? '松开发送' : (label || '按住说话') }}</text>
    </view>
    <text v-if="!hideHint" class="rec-hint">{{ hint }}</text>
  </view>
</template>

<script setup lang="ts">
/**
 * 按住说话：按下即录音（按钮变红），松开结束并交由上层转写评价。
 * 输入框与录音长期并存，本组件不再负责「改用输入框」，也不再因为失败把页面锁在输入模式。
 */
import { computed, ref } from 'vue'
import { startRecording, stopRecording, recordAvailable } from '@/services'
import { ensurePermission } from '@/utils/permission'
import { errText, logger } from '@/utils/log'

const props = defineProps<{ disabled?: boolean; busy?: boolean; label?: string; hint?: string; hideHint?: boolean }>()
const emit = defineEmits<{
  (e: 'recorded', clip: { base64: string; path: string }): void
  (e: 'start'): void
}>()

/** 手指 / 鼠标是否仍按着（权限弹窗期间松手也不能留下一条停不掉的录音） */
const pressing = ref(false)
const recording = ref(false)
/** 触摸后浏览器会补发 mousedown，500ms 内忽略，避免松手后又自动开始录 */
let ignoreMouseUntil = 0
let startedAt = 0
let capTimer: ReturnType<typeof setTimeout> | null = null

const canRecord = recordAvailable()

const hint = computed(() => {
  if (recording.value) return '松开发送，超过 60 秒自动结束'
  if (props.busy) return '正在评价上一条…'
  if (props.disabled) return '等本题播放完再按住录音'
  if (!canRecord) return '浏览器预览不支持录音，请用输入框；APK 内两者都可用'
  return props.hint || '按住录音，松开发送；也可以直接打字'
})

function onTouchStart() {
  ignoreMouseUntil = 0
  void begin()
}

function onMouseDown() {
  if (Date.now() < ignoreMouseUntil) return
  void begin()
}

function onTouchEnd() {
  ignoreMouseUntil = Date.now() + 500
  onPressEnd()
}

async function begin() {
  if (pressing.value) return
  if (props.disabled || props.busy) {
    // 按下没反应最容易让人以为「录音坏了」，这里明确提示一次
    logger.warn('rec.press.blocked', { disabled: !!props.disabled, busy: !!props.busy })
    uni.showToast({ title: props.busy ? '正在评价上一条，稍等' : '等本题播放完再按住录音', icon: 'none' })
    return
  }
  pressing.value = true
  logger.info('rec.press', { canRecord })
  if (!canRecord) {
    pressing.value = false
    logger.warn('rec.unavailable', {})
    uni.showToast({ title: '当前环境不支持录音，请用输入框作答', icon: 'none' })
    return
  }
  const t0 = Date.now()
  const ok = await ensurePermission('record')
  logger.info('rec.perm', { granted: ok, ms: Date.now() - t0, stillPressed: pressing.value })
  if (!pressing.value) {
    // 系统权限框会吞掉触摸：授权过程里松手就绝不启动，避免留下停不掉的录音
    logger.warn('rec.press.lost', { granted: ok })
    return
  }
  if (!ok) {
    pressing.value = false
    uni.showToast({ title: '没有录音权限，请到系统设置里开启，或用输入框作答', icon: 'none' })
    return
  }
  try {
    startRecording()
  } catch (e) {
    pressing.value = false
    logger.error('rec.start.fail', { msg: errText(e) })
    uni.showToast({ title: errText(e) || '录音启动失败，请用输入框作答', icon: 'none' })
    return
  }
  recording.value = true
  emit('start')
  startedAt = Date.now()
  capTimer = setTimeout(() => { if (recording.value) void finish() }, 60000)
}

async function onPressEnd() {
  if (!pressing.value && !recording.value) return
  logger.info('rec.release', { pressing: pressing.value, recording: recording.value })
  pressing.value = false
  if (!recording.value) return
  await finish()
}

async function finish() {
  if (capTimer) { clearTimeout(capTimer); capTimer = null }
  recording.value = false
  const dur = Date.now() - startedAt
  // mp3 编码至少要有半秒以上的音频，太短会出现「录到了但没有数据」的假失败
  if (dur < 600) {
    logger.warn('rec.too-short', { dur })
    uni.showToast({ title: '说得太快了，按住说完再松开', icon: 'none' })
    return
  }
  logger.info('rec.finish.req', { dur })
  try {
    const r = await stopRecording()
    logger.info('rec.finish.ok', { dur, kb: Math.round(r.base64.length / 1024) })
    // 音频本体 + 本地文件都交给上层：文件用于「听我的录音」回放
    emit('recorded', { base64: r.base64, path: r.path })
  } catch (e) {
    logger.error('rec.finish.fail', { dur, msg: errText(e) })
    uni.showToast({ title: errText(e) || '录音失败，请用输入框作答', icon: 'none' })
  }
}
</script>

<style scoped>
.recorder { display: flex; flex-direction: column; align-items: center; }
.rec-circle {
  width: 140rpx; height: 140rpx; border-radius: 50%;
  background: linear-gradient(135deg, #fb923c, #f97316);
  color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 0 14rpx 32rpx rgba(249, 115, 22, .32);
  transition: transform .15s ease, background .15s ease;
  user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
}
.rec-circle.recording {
  background: linear-gradient(135deg, #fb7185, #ef4444);
  box-shadow: 0 0 0 12rpx rgba(239, 68, 68, .14), 0 14rpx 30rpx rgba(239, 68, 68, .3);
  transform: scale(1.04);
  animation: breathe 1.2s ease-in-out infinite;
}
.rec-circle.muted { background: linear-gradient(135deg, #cbd2e1, #aeb7c9); box-shadow: none; }
@keyframes breathe { 0%, 100% { transform: scale(1.04); } 50% { transform: scale(1.08); } }
.mic { width: 38rpx; height: 46rpx; position: relative; margin-bottom: 8rpx; }
.mic-cap {
  position: absolute; left: 50%; top: 0; transform: translateX(-50%);
  width: 20rpx; height: 26rpx; border-radius: 10rpx; background: currentColor;
}
.mic-arc {
  position: absolute; left: 50%; top: 11rpx; transform: translateX(-50%);
  width: 38rpx; height: 24rpx; border: 4rpx solid currentColor;
  border-top: none; border-radius: 0 0 22rpx 22rpx;
}
.mic-stem {
  position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  width: 4rpx; height: 9rpx; background: currentColor;
}
.rec-state { font-size: 22rpx; font-weight: 600; letter-spacing: 1rpx; }
.rec-hint { font-size: 21rpx; color: var(--elr-muted); margin-top: 12rpx; }
</style>

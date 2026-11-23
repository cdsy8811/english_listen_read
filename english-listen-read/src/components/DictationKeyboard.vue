<template>
  <view class="kb">
    <view class="kb-hint">自定义键盘 · 不会调用系统输入法</view>

    <view v-for="(row, ri) in LETTER_ROWS" :key="ri" class="kb-row" :class="{ 'row-a': ri === 1 }">
      <view
        v-for="k in row" :key="k"
        class="kb-key"
        :class="{ off: disabled }"
        @click="onLetter(k)"
      >{{ k }}</view>
    </view>

    <view class="kb-row">
      <view class="kb-key wide" :class="{ off: disabled || !hasText }" @click="onBackspace">⌫</view>
      <view class="kb-key space" :class="{ off: disabled }" @click="onSpace">空格</view>
      <view class="kb-key wide" :class="{ off: disabled || !hasText }" @click="onClear">清空</view>
    </view>

    <!-- 功能键固定在键盘里：不再占用页面底部操作条 -->
    <view class="kb-row fn-row">
      <view class="kb-fn" :class="{ off: !canCancel }" @click="onFn('cancel')">取消</view>
      <view class="kb-fn" :class="{ off: !canPrev }" @click="onFn('prev')">上一条</view>
      <view class="kb-fn primary" :class="{ off: !canNext }" @click="onFn('next')">下一条</view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * 默写专用的自定义 26 键键盘。
 * 刻意不使用 uni 的 input / textarea：系统输入法带 AI、翻译、联想，会把默写变成「抄写」。
 * 字母、退格、空格、清空与「取消 / 上一条 / 下一条」全部由本组件承担，页面只接收事件。
 */
const LETTER_ROWS: string[][] = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
]

const props = defineProps<{
  /** 非作答态（播放 / 评价中 / 已出成绩）时整块键盘置灰，不接受输入 */
  disabled?: boolean
  /** 有没有已输入的字母：决定退格 / 清空是否可用 */
  hasText?: boolean
  canCancel?: boolean
  canPrev?: boolean
  canNext?: boolean
}>()

const emit = defineEmits<{
  (e: 'letter', ch: string): void
  (e: 'space'): void
  (e: 'backspace'): void
  (e: 'clear'): void
  (e: 'cancel'): void
  (e: 'prev'): void
  (e: 'next'): void
}>()

function onLetter(ch: string) {
  if (props.disabled) return
  emit('letter', ch.toLowerCase())
}

function onSpace() {
  if (props.disabled) return
  emit('space')
}

function onBackspace() {
  if (props.disabled || !props.hasText) return
  emit('backspace')
}

function onClear() {
  if (props.disabled || !props.hasText) return
  emit('clear')
}

function onFn(which: 'cancel' | 'prev' | 'next') {
  if (which === 'cancel') {
    if (props.canCancel) emit('cancel')
    return
  }
  if (which === 'prev') {
    if (props.canPrev) emit('prev')
    return
  }
  if (props.canNext) emit('next')
}
</script>

<style scoped>
.kb {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  padding: 14rpx 12rpx calc(14rpx + env(safe-area-inset-bottom));
  background: #e9edf6;
  border-top: 1rpx solid #dde2ee;
  box-shadow: 0 -8rpx 26rpx rgba(27, 33, 48, .08);
}
.kb-hint {
  font-size: 19rpx; color: #9aa3b7; text-align: center;
  margin-bottom: 10rpx;
}
.kb-row { display: flex; align-items: center; gap: 9rpx; margin-bottom: 10rpx; }
.kb-row:last-child { margin-bottom: 0; }
/* 第二行（ASDF…）留出左右半键的空位，贴合常见 26 键布局 */
.row-a { padding: 0 24rpx; }

.kb-key {
  flex: 1; min-width: 0; height: 84rpx; border-radius: 14rpx;
  background: #fff; color: #1f2637;
  font-size: 32rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2rpx 0 #cfd6e6;
  user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
}
.kb-key:active { background: #f0e2d6; }
.kb-key.wide { flex: 0 0 108rpx; font-size: 28rpx; }
.kb-key.space { font-size: 24rpx; font-weight: 500; color: #47506a; }
.kb-key.off { opacity: .38; }

.kb-fn {
  flex: 1; min-width: 0; height: 76rpx; border-radius: 14rpx;
  background: #f6f8fd; color: #47506a;
  font-size: 26rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2rpx 0 #cfd6e6;
  user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
}
.kb-fn.primary { background: var(--elr-primary); color: #fff; box-shadow: 0 2rpx 0 #ea580c; }
.kb-fn:active { opacity: .8; }
.kb-fn.off { opacity: .4; background: #f5f0ea; color: #9aa3b7; box-shadow: none; }
.kb-fn.primary.off { background: #fdba74; color: #fff; }
</style>

<template>
  <view class="page">
    <!-- 进度与状态 -->
    <view class="card">
      <view class="row">
        <text class="title">{{ modeTitle }}</text>
        <text class="tag">{{ stateLabel }}</text>
      </view>
      <view class="divider" />
      <view class="row">
        <text class="sub">{{ index + 1 }} / {{ words.length }}</text>
        <text class="sub">{{ unitTitle }}</text>
      </view>
      <progress :percent="percent" show-info stroke-width="6" activeColor="#2f6fed" />
    </view>

    <!-- 题目 / 词条 -->
    <view class="card" v-if="current">
      <text class="sub">{{ mode === '2.2' ? '请说出 / 写出英文' : mode === '2.3' ? '请说出 / 写出中文释义' : '正在共读' }}</text>
      <text class="big-word">{{ mode === '2.2' ? current.translation : current.word }}</text>
      <text v-if="current.phonetic_us" class="phonetic">{{ current.phonetic_us }}</text>
      <text v-if="mode === '2.3' && current.pos" class="tag">{{ current.pos }}</text>
      <view class="divider" />
      <text class="sub">播放：{{ playingLabel }}</text>
      <button v-if="pendingManualPlay" class="btn" style="margin-top: 20rpx" @click="onManualPlay">播放本题</button>
    </view>

    <!-- 2.1 共读：只有控制按钮 -->
    <view class="card" v-if="mode === '2.1'">
      <view class="row">
        <button class="btn btn-plain" style="flex: 1; margin-right: 16rpx" @click="onPrev">上一条</button>
        <button class="btn btn-ghost" style="flex: 1; margin-right: 16rpx" @click="onReplay">重播</button>
        <button class="btn" style="flex: 1" @click="onNext">下一条</button>
      </view>
      <button class="btn btn-plain" style="margin-top: 20rpx" @click="onStop">结束练习</button>
    </view>

    <!-- 2.2 / 2.3 作答区 -->
    <view class="card" v-else>
      <AnswerInput v-if="answerType === 'input' || fallbackInput" v-model="typed" :disabled="state !== 'awaiting'"
        :placeholder="mode === '2.2' ? '输入英文单词' : '输入中文释义'" @submit="onSubmitText" />
      <RecorderButton v-else :disabled="state !== 'awaiting'" :busy="state === 'evaluating'"
        @recorded="onRecorded" @fallback="onFallback" />
      <view class="row" style="margin-top: 24rpx">
        <button class="btn btn-plain btn-sm" @click="onReplay">重听</button>
        <button class="btn btn-plain btn-sm" @click="onSkip">跳过</button>
        <button class="btn btn-sm" v-if="advanceMode === 'submit' && (answerType === 'input' || fallbackInput)"
          :disabled="state !== 'awaiting'" @click="onSubmitText">提交</button>
      </view>
      <text v-if="asrHint" class="sub" style="display: block; margin-top: 16rpx">识别结果：{{ asrHint }}</text>
      <text class="sub" style="display: block; margin-top: 12rpx">评价口径：内容正确度（文本对错），不含发音评分</text>
    </view>

    <!-- 2.2 / 2.3 结果卡 -->
    <ScoreCard v-if="lastResult" :result="lastResult" :mode="mode" @retry="onRetry" @next="commitAdvance" />
  </view>
</template>

<script setup lang="ts">
import { onLoad, onUnload, onHide } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import AnswerInput from '@/components/AnswerInput.vue'
import RecorderButton from '@/components/RecorderButton.vue'
import ScoreCard from '@/components/ScoreCard.vue'
import { useSettingsStore } from '@/store/settings'
import { usePracticeStore } from '@/store/practice'
import { listWords, getUnit, addRecord, newId } from '@/services/storage'
import { PlayQueue, buildReadSegments, buildPromptSegment, transcribe, evaluate, playQueue } from '@/services'
import { localEvaluate } from '@/services/evaluator'
import { createAdvanceController } from '@/services/advance'
import { StateMachine, type PracticeState } from '@/services/progress'
import type { EvalResult, PracticeMode, Word } from '@/services/types'

const settings = useSettingsStore()
const practice = usePracticeStore()

const mode = ref<PracticeMode>('2.1')
const words = ref<Word[]>([])
const index = ref(0)
const unitId = ref('')
const unitTitle = ref('')
const typed = ref('')
const asrHint = ref('')
const fallbackInput = ref(false)
const lastResult = ref<EvalResult | null>(null)
const playingLabel = ref('待播放')
const pendingManualPlay = ref(false)
const machine = new StateMachine()
const state = ref<PracticeState>('idle')
machine.onChange((s) => { state.value = s })

let queue: PlayQueue = playQueue
/** 每次重新播放递增，让旧的异步协程失效，避免重播 / 上一条 / 下一条并发推进 */
let runToken = 0
const advanceCtl = createAdvanceController({
  getMode: () => settings.data.advanceMode,
  getWaitSec: () => settings.data.waitSec,
  onAdvance: () => advance(),
})

const current = computed(() => words.value[index.value] || null)
const percent = computed(() => words.value.length ? Math.round(index.value / words.value.length * 100) : 0)
const answerType = computed(() => fallbackInput.value ? 'input' : settings.data.answerType)
const advanceMode = computed(() => settings.data.advanceMode)
const modeTitle = computed(() => ({ '2.1': '2.1 中英共读', '2.2': '2.2 看中说英', '2.3': '2.3 看英说中' })[mode.value])
const stateLabel = computed(() => ({
  idle: pendingManualPlay.value ? '等待播放' : '准备中',
  playing: '播放中', awaiting: '请作答', evaluating: '评价中', advancing: '进入下一条',
})[state.value])

onLoad(async (q) => {
  await settings.load()
  unitId.value = q?.unitId || ''
  const m = q?.mode as PracticeMode
  mode.value = ['2.1', '2.2', '2.3'].includes(m) ? m : '2.1'
  const u = await getUnit(unitId.value)
  unitTitle.value = u?.title || ''
  words.value = await listWords(unitId.value)
  practice.start(unitId.value, mode.value, words.value.length)
  if (words.value.length) void runCurrent()
})

onHide(() => cleanup())
onUnload(() => cleanup())

/** 中断当前播放：递增令牌 + 停止队列，二者缺一不可（stop 后新协程会重置 cancelled）。 */
function interrupt() {
  runToken++
  queue.stop()
}

function cleanup() {
  interrupt()
  advanceCtl.cancel()
  machine.reset()
  state.value = 'idle'
}

async function runCurrent() {
  advanceCtl.reset()
  if (!current.value) { finish(); return }
  machine.reset()
  state.value = 'idle'
  lastResult.value = null
  typed.value = ''
  asrHint.value = ''
  if (!settings.data.autoPlay) {
    // 不自动播放时保持 idle，等待用户点「播放本题」，不绕开状态机
    pendingManualPlay.value = true
    playingLabel.value = '已就绪，点「播放本题」开始'
    return
  }
  await startPlay(++runToken)
}

async function onManualPlay() {
  if (!pendingManualPlay.value) return
  await startPlay(++runToken)
}

/** 状态机入口：idle → playing → (awaiting | advancing)。 */
async function startPlay(token: number) {
  pendingManualPlay.value = false
  if (!machine.to('playing')) return
  const w = current.value
  if (!w) return
  const segments = mode.value === '2.1'
    ? buildReadSegments(w, settings.data)
    : [buildPromptSegment(w, mode.value as '2.2' | '2.3')]
  await queue.playSegments(segments, {
    speed: settings.data.speed,
    volume: settings.data.volume,
    onSegStart: (seg) => { playingLabel.value = `${seg.label}：${seg.text}` },
  })
  if (token !== runToken || queue.isCancelled) return
  if (mode.value === '2.1') {
    machine.to('advancing')
    // 共读：间隔 N 秒后自动下一条（可取消计时器，与播放回调不冲突）
    await queue.waitGap(settings.data.itemGapSec)
    if (token !== runToken || queue.isCancelled) return
    advance()
  } else {
    machine.to('awaiting')
    playingLabel.value = '播放完毕，请作答'
  }
}

/* ---------------- 2.1 控制 ---------------- */
function onReplay() { interrupt(); void runCurrent() }
function onNext() { interrupt(); advance() }
function onPrev() { interrupt(); if (index.value > 0) { index.value--; void runCurrent() } }
function onStop() { cleanup(); uni.navigateBack() }

/* ---------------- 2.2 / 2.3 作答 ---------------- */
async function onRecorded(base64: string) {
  if (state.value !== 'awaiting') return
  if (!machine.to('evaluating')) return
  playingLabel.value = '正在转写与评价…'
  try {
    const lang = mode.value === '2.2' ? 'en' : 'zh'
    const text = await transcribe(base64, lang)
    asrHint.value = text
    await judge(text, 'record')
  } catch (_) {
    machine.to('advancing')
    fallbackInput.value = true
    uni.showToast({ title: '录音识别失败，已切换输入框作答', icon: 'none' })
    machine.reset(); machine.to('playing'); machine.to('awaiting')
  }
}

function onFallback() {
  fallbackInput.value = true
  uni.showToast({ title: '已切换输入框作答', icon: 'none' })
}

async function onSubmitText() {
  if (state.value !== 'awaiting' || !typed.value.trim()) return
  if (!machine.to('evaluating')) return
  await judge(typed.value.trim(), 'input')
}

async function judge(answer: string, inputType: 'record' | 'input') {
  const w = current.value
  if (!w) return
  let result: EvalResult
  try {
    result = await evaluate({
      mode: mode.value, word: w, answer, asrText: inputType === 'record' ? answer : '',
      inputType, strictness: settings.data.strictness,
    })
  } catch (_) {
    // 云判分失败也必须有结果（能力层已兜底，这里再保底）
    result = localEvaluate({ mode: mode.value, word: w, answer, asrText: '', inputType, strictness: settings.data.strictness })
  }
  lastResult.value = result
  practice.record({ wordId: w.id, word: w.word, score: result.score, result })
  await addRecord({
    id: newId('r'), word_id: w.id, mode: mode.value, input_type: inputType,
    raw_text: inputType === 'input' ? answer : '', asr_text: inputType === 'record' ? answer : '',
    score: result.score, detail_json: JSON.stringify(result), created_at: Date.now(),
  })
  if (!machine.to('advancing')) return
  // 两种推进模式互斥：timer 只挂一个可取消计时器，submit 等用户点「下一条」
  advanceCtl.schedule()
}

function onRetry() {
  advanceCtl.cancel()
  interrupt()
  void runCurrent()
}

function onSkip() {
  const w = current.value
  if (w) practice.record({ wordId: w.id, word: w.word, score: 0, result: null })
  advanceCtl.commitNow()
}

function commitAdvance() { advanceCtl.commitNow() }

function advance() {
  if (index.value >= words.value.length - 1) { finish(); return }
  index.value++
  machine.reset()
  state.value = 'idle'
  void runCurrent()
}

function finish() {
  cleanup()
  uni.redirectTo({ url: `/pages/result/result?unitId=${unitId.value}&mode=${mode.value}` })
}
</script>

<style scoped>
.big-word { display: block; font-size: 52rpx; font-weight: 600; margin: 16rpx 0; }
.phonetic { font-size: 28rpx; color: var(--elr-muted); margin-right: 16rpx; }
</style>

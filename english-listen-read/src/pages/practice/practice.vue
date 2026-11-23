<template>
  <view class="page p-page" :class="{ 'has-mic-dock': mode !== '2.1' && !dictation, 'has-keyboard': dictation }">
    <!-- 进度 -->
    <view class="p-top">
      <view class="p-mode-wrap">
        <text class="p-mode">{{ modeShort }}</text>
        <text class="p-mode-sub">{{ modeTitle }}</text>
      </view>
      <text class="p-count">{{ index + 1 }}<text class="p-count-total"> / {{ words.length }}</text></text>
    </view>
    <view class="p-track">
      <view class="p-fill" :style="{ width: percent + '%' }" />
    </view>
    <view class="p-meta">
      <text class="p-unit">{{ unitTitle }}</text>
      <text class="p-state">{{ stateLabel }}</text>
    </view>

    <!-- 当前词条 -->
    <view class="word-card" v-if="current">
      <text class="word-prompt">{{ promptText }}</text>
      <text class="word-main">{{ displayWord }}</text>
      <text v-if="mode === '2.3' && current.pos" class="word-pos">{{ current.pos }}</text>
      <text v-if="mode !== '2.2' && phonetic" class="word-phonetic">{{ phonetic }}</text>
      <text v-if="mode === '2.1' && current.translation" class="word-trans">{{ current.translation }}</text>

      <view class="play-state">
        <view class="dot" :class="state" />
        <text class="play-label">{{ playingLabel }}</text>
      </view>
      <view class="word-actions">
        <button v-if="pendingManualPlay" class="btn" @click="onManualPlay">播放本题</button>
        <button v-else-if="mode !== '2.1' && !lastResult && !dictation" class="btn btn-plain btn-sm" :disabled="state === 'evaluating'"
          @click="onReplayPrompt">重听本题</button>
      </view>
    </view>

    <!-- 2.1 共读控制 -->
    <view v-if="mode === '2.1'" class="controls">
      <view class="ctrl" @click="onPrev">
        <text class="ctrl-icon">‹</text>
        <text class="ctrl-label">上一条</text>
      </view>
      <view class="ctrl primary" @click="onReplay">
        <text class="ctrl-icon">↻</text>
        <text class="ctrl-label">重播</text>
      </view>
      <view class="ctrl" @click="onNext">
        <text class="ctrl-icon">›</text>
        <text class="ctrl-label">下一条</text>
      </view>
    </view>
    <button v-if="mode === '2.1'" class="btn btn-plain stop-btn" @click="onStop">结束练习</button>

    <!-- 2.2 / 2.3 / 默写作答区 -->
    <view v-else class="answer-card">
      <text class="answer-title">你的作答</text>

      <!-- 默写：只接自定义键盘，不渲染 input，系统输入法的 AI / 翻译彻底用不上 -->
      <view v-if="dictation" class="typed-box" :class="{ empty: !typed }">
        {{ typed || '看中文，用下方键盘输入英文' }}
      </view>

      <!-- 2.3：中文作答，系统输入法不限制 -->
      <AnswerInput v-else-if="mode === '2.3'" v-model="typed" :disabled="state !== 'awaiting'"
        placeholder="输入中文释义" @submit="onSubmitText" />

      <!-- 2.2：只保留语音作答，不再提供手工输入 -->
      <view v-else class="voice-box">
        <text class="voice-title">看中文 · 说英文</text>
        <text class="voice-sub">按住下方圆钮说出英文单词，松手自动检查；同音词按内容正确度容错。</text>
      </view>

      <button v-if="dictation || mode === '2.3'" class="btn answer-submit"
        :disabled="state !== 'awaiting' || !typed.trim()" @click="onSubmitText">
        提交
      </button>

      <view class="answer-tools">
        <text class="tool-link muted" @click="toggleLogs">{{ logOpen ? '收起日志' : '排障日志' }}</text>
      </view>
      <view v-if="asrHint || recordPath" class="asr-box">
        <text v-if="asrHint" class="asr-hint">识别结果：{{ asrHint }}</text>
        <text v-else class="asr-hint">没有识别到内容，可以回听自己的录音</text>
        <!-- 正常流程里回放入口在下面的结果卡（标准答案 / 你的作答两行）；这里只兜住「转写失败、没有结果卡」的情况 -->
        <view v-if="!lastResult" class="asr-actions">
          <text class="asr-play" :class="{ on: playingClip === 'word' }" @click="playExpectedClip">
            {{ playingClip === 'word' ? '■ 停止' : '▶ 听单词' }}
          </text>
          <text v-if="recordPath" class="asr-play" :class="{ on: playingClip === 'mine' }" @click="playMyClip">
            {{ playingClip === 'mine' ? '■ 停止' : '▶ 我的录音' }}
          </text>
        </view>
      </view>
      <text class="answer-note">{{ dictation ? '默写口径：只看中文写英文，按内容正确度评分' : '评价口径：内容正确度（文本对错），不含发音评分' }}</text>
    </view>

    <!-- 2.2 / 2.3 底部操作条：左「取消」= 跳过本题，中间按住说话，右「下一条」 -->
    <view v-if="mode !== '2.1' && !dictation" class="mic-dock">
      <view v-if="logOpen" class="log-panel">
        <scroll-view class="log-list" scroll-y :scroll-into-view="logAnchor" scroll-with-animation>
          <view v-for="(l, i) in logs" :key="i" :id="'log' + i">
            <text class="log-line">{{ l }}</text>
          </view>
          <view v-if="!logs.length"><text class="log-line">（暂无日志）</text></view>
        </scroll-view>
        <view class="log-actions">
          <text class="tool-link" @click="copyLogs">复制全部日志</text>
          <text class="tool-link" @click="clearLogs">清空</text>
        </view>
      </view>
      <view class="dock-bar" :class="{ wide: dictation }">
        <button class="btn btn-plain dock-btn" :disabled="state !== 'awaiting'" @click="onCancel">取消</button>
        <view v-if="!dictation" class="dock-mic">
          <RecorderButton :disabled="state !== 'awaiting'" :busy="state === 'evaluating'"
            :hint="recHint" @recorded="onRecorded" />
        </view>
        <button class="btn dock-btn" :disabled="!lastResult" @click="onNextItem">下一条</button>
      </view>
    </view>

    <!-- 默写：自定义 26 键键盘固定在页底，取消 / 上一条 / 下一条也在键盘里 -->
    <DictationKeyboard
      v-if="dictation"
      :disabled="state !== 'awaiting'"
      :has-text="!!typed"
      :can-cancel="state === 'awaiting'"
      :can-prev="index > 0"
      :can-next="!!lastResult"
      @letter="onKeyLetter"
      @space="onKeySpace"
      @backspace="onKeyBackspace"
      @clear="typed = ''"
      @cancel="onCancel"
      @prev="onPrevItem"
      @next="onNextItem"
    />

    <!-- 2.2 / 2.3 结果卡 -->
    <ScoreCard v-if="lastResult" :result="lastResult" :mode="mode"
      :record-path="recordPath" :playing="playingClip" :allow-retext="mode === '2.3'"
      @retry="onRetry" @next="commitAdvance" @type="onTypeInstead"
      @play-word="playExpectedClip" @play-mine="playMyClip" />
  </view>
</template>

<script setup lang="ts">
import { onLoad, onUnload, onHide, onBackPress, onShow } from '@dcloudio/uni-app'
import { computed, nextTick, ref } from 'vue'
import AnswerInput from '@/components/AnswerInput.vue'
import DictationKeyboard from '@/components/DictationKeyboard.vue'
import RecorderButton from '@/components/RecorderButton.vue'
import ScoreCard from '@/components/ScoreCard.vue'
import { useSettingsStore } from '@/store/settings'
import { usePracticeStore } from '@/store/practice'
import { listWords, getUnit, addRecord, addStudySession, newId } from '@/services/storage'
import { PlayQueue, buildReadSegments, buildPromptSegment, transcribe, evaluate, playQueue } from '@/services'
import { localEvaluate } from '@/services/evaluator'
import { createAdvanceController } from '@/services/advance'
import { StateMachine, type PracticeState } from '@/services/progress'
import { ensurePermission } from '@/utils/permission'
import { clearLogHistory, errText, logHistory, logger } from '@/utils/log'
import { shuffle } from '@/utils/random'
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
/** 本次录音的本地临时文件：用于「听我的录音」回放（转写失败也能回放） */
const recordPath = ref('')
/** 正在回放的片段：单词 / 我的录音 */
const playingClip = ref<'' | 'word' | 'mine'>('')
/** 默写：2.2 的「只打字」变体 —— 只显示中文、不朗读、不录音，输入英文后提交 */
const dictation = ref(false)
const lastResult = ref<EvalResult | null>(null)
const playingLabel = ref('待播放')
const pendingManualPlay = ref(false)

/* ---------------- 排障日志面板 ---------------- */
const logOpen = ref(false)
const logs = ref<string[]>([])
/** 自动滚到最新一行 */
const logAnchor = ref('')
let logTimer: ReturnType<typeof setInterval> | null = null

/** 面板里过滤掉逐条 SQL 噪音（仍在完整历史里，只影响显示） */
function refreshLogs() {
  logs.value = logHistory().filter((l) => !/\[db\.(exec|select|tx)\]/.test(l))
  logAnchor.value = logs.value.length ? `log${logs.value.length - 1}` : ''
}

function stopLogTimer() {
  if (logTimer) { clearInterval(logTimer); logTimer = null }
}

function toggleLogs() {
  logOpen.value = !logOpen.value
  if (logOpen.value) {
    refreshLogs()
    stopLogTimer()
    logTimer = setInterval(refreshLogs, 1000)
  } else stopLogTimer()
}

function copyLogs() {
  refreshLogs()
  uni.setClipboardData({ data: logs.value.join('\n') })
}

function clearLogs() {
  clearLogHistory()
  refreshLogs()
}
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
const modeTitle = computed(() => dictation.value
  ? '默写 · 看中文写英文'
  : mode.value === '2.1'
    ? ({ 'en-only': '只读英文', 'en-zh': '英 → 中', 'zh-en': '中 → 英' })[settings.data.playOrder]
    : ({ '2.1': '', '2.2': '看中说英', '2.3': '看英说中' })[mode.value])
const modeShort = computed(() => dictation.value ? '默写' : ({ '2.1': '学习', '2.2': '中英', '2.3': '英中' })[mode.value])
const promptText = computed(() => dictation.value ? '看中文 · 写出英文'
  : ({
    '2.1': '听 · 跟读',
    '2.2': '请说出 / 写出英文',
    '2.3': '请说出 / 写出中文释义',
  })[mode.value])
const displayWord = computed(() => {
  if (!current.value) return ''
  return mode.value === '2.2' ? current.value.translation : current.value.word
})
const phonetic = computed(() => {
  if (!current.value) return ''
  return current.value.phonetic_us || current.value.phonetic_uk
})
const stateLabel = computed(() => ({
  idle: pendingManualPlay.value ? '等待播放' : '准备中',
  playing: '播放中', awaiting: '请作答', evaluating: '评价中', advancing: '进入下一条',
})[state.value])
/** 2.2 只能语音，提示里不要再提「也可以打字」 */
const recHint = computed(() => mode.value === '2.2'
  ? '看中文说英文，松手自动检查'
  : '说中文，也可以打字作答')

/* ---------------- 学习记录：本次会话的时长与作答概况 ---------------- */
let sessionStart = 0
let sessionAttempts = 0
let sessionScoreSum = 0
let sessionPassed = 0
let sessionSaved = false

function resetSessionStats() {
  sessionStart = Date.now()
  sessionAttempts = 0
  sessionScoreSum = 0
  sessionPassed = 0
}

function countAttempt(score: number) {
  sessionAttempts++
  sessionScoreSum += score
  if (score >= 60) sessionPassed++
}

/** 落一条学习记录；误触（<10s 且没作答）不记。重复调用只写一次。 */
async function saveSession() {
  if (sessionSaved || !sessionStart) return
  const elapsed = Math.round((Date.now() - sessionStart) / 1000)
  if (elapsed < 10 && sessionAttempts === 0) return
  sessionSaved = true
  try {
    await addStudySession({
      id: newId('ss'),
      kind: 'practice',
      mode: dictation.value ? 'dictation' : mode.value,
      unit_id: unitId.value,
      title: unitTitle.value || '词条练习',
      started_at: sessionStart,
      ended_at: Date.now(),
      duration_sec: elapsed,
      total: words.value.length,
      answered: sessionAttempts,
      passed: sessionPassed,
      avg_score: sessionAttempts ? Math.round(sessionScoreSum / sessionAttempts) : 0,
      created_at: Date.now(),
    })
  } catch (e) {
    logger.warn('page.session.fail', { msg: errText(e) })
  }
}

onLoad(async (q) => {
  await settings.load()
  unitId.value = q?.unitId || ''
  const ids = unitId.value.split(',').map((x) => x.trim()).filter(Boolean)
  const m = q?.mode as PracticeMode
  mode.value = ['2.1', '2.2', '2.3'].includes(m) ? m : '2.1'
  // 默写入口：mode=2.2&input=type，复用 2.2 的内容正确度评价，只是不朗读、只能打字
  dictation.value = q?.input === 'type'
  const units = await Promise.all(ids.map((id) => getUnit(id)))
  const titles = units.map((u) => u?.title).filter(Boolean) as string[]
  unitTitle.value = titles.length
    ? titles.join(' · ')
    : (ids.length > 1 ? `${ids.length} 个单元` : '')
  const lists = await Promise.all(ids.map((id) => listWords(id)))
  const allWords = lists.flat()
  // 选择模式：mode 页把勾选词条的下标用 picks 传过来，这里还原成子集
  const picksParam = String(q?.picks || '')
  const picks = picksParam
    ? picksParam
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < allWords.length)
    : []
  words.value = picks.length ? picks.map((i) => allWords[i] as Word) : allWords
  // 错词本「默写重练」只练勾中的词：wordIds 是跨单元的精确子集
  const idsParam = String(q?.wordIds || '')
  const onlyIds = idsParam
    ? new Set(idsParam.split(',').map((x) => x.trim()).filter(Boolean))
    : null
  if (onlyIds) words.value = words.value.filter((w) => onlyIds.has(w.id))
  // 随机模式：只在 2.2 / 2.3 生效，2.1 共读保持顺序（听完顺序更有意义）
  const shuffled = mode.value !== '2.1' && settings.data.randomOrder
  if (shuffled) words.value = shuffle(words.value)
  logger.info('page.practice.load', {
    mode: mode.value, units: ids.length, words: words.value.length, autoPlay: settings.data.autoPlay, shuffled, picked: picks.length,
  })
  practice.start(unitId.value, mode.value, words.value.length)
  resetSessionStats()
  // 2.2 / 2.3 先预热麦克风权限：权限系统框会抢走触摸，预热过才能做到「按下即录」（默写不用麦克风）
  if (mode.value !== '2.1' && !dictation.value) {
    void ensurePermission('record').then((ok) => logger.info('perm.prewarm', { ok }))
  }
  if (words.value.length) void runCurrent()
})

onHide(() => cleanup())
onUnload(() => cleanup())
/** 从后台 / 其他页面回来：上一次已经落库，重新开始计时与计数 */
onShow(() => {
  if (sessionSaved && words.value.length) {
    sessionSaved = false
    resetSessionStats()
  }
})
/**
 * 返回上级页面时先停播再放行：onUnload 也能停，但它在页面销毁之后才触发，
 * 手感上会「多响半句」。返回 false 表示不拦截系统返回，只做清理。
 */
onBackPress(() => { cleanup(); return false })

/** 中断当前播放：递增令牌 + 停止队列，二者缺一不可（stop 后新协程会重置 cancelled）。 */
function interrupt() {
  runToken++
  queue.stop()
}

function cleanup() {
  interrupt()
  advanceCtl.cancel()
  stopLogTimer()
  machine.reset()
  state.value = 'idle'
  void saveSession()
}

async function runCurrent(opts: { keepAnswer?: boolean } = {}) {
  advanceCtl.reset()
  if (!current.value) { finish(); return }
  machine.reset()
  state.value = 'idle'
  lastResult.value = null
  // 「重听本题」不清掉已输入的作答，避免用户白打一遍
  if (!opts.keepAnswer) {
    typed.value = ''
    asrHint.value = ''
    recordPath.value = ''
    playingClip.value = ''
  }
  // 默写没有音频要播：不等 autoPlay 开关，直接进入作答态
  if (dictation.value) { await startPlay(++runToken); return }
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
  // 默写：只展示中文，不放音；状态机仍然走 playing → awaiting
  if (dictation.value) {
    machine.to('awaiting')
    playingLabel.value = '默写：按中文写出英文单词'
    return
  }
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
/** 2.2 / 2.3 的「重听本题」：保留已输入的作答 */
function onReplayPrompt() { interrupt(); void runCurrent({ keepAnswer: true }) }
function onNext() { interrupt(); advance() }
function onPrev() { interrupt(); if (index.value > 0) { index.value--; void runCurrent() } }
function onStop() { cleanup(); uni.navigateBack() }

/* ---------------- 默写：自定义键盘输入（不经过系统输入法） ---------------- */

const MAX_TYPED = 40

function onKeyLetter(ch: string) {
  if (state.value !== 'awaiting' || typed.value.length >= MAX_TYPED) return
  typed.value += ch
}

function onKeySpace() {
  if (state.value !== 'awaiting' || typed.value.length >= MAX_TYPED) return
  if (!typed.value || typed.value.endsWith(' ')) return
  typed.value += ' '
}

function onKeyBackspace() {
  if (state.value !== 'awaiting') return
  typed.value = typed.value.slice(0, -1)
}

/* ---------------- 2.2 / 2.3 作答 ---------------- */
async function onRecorded(clip: { base64: string; path: string }) {
  if (state.value !== 'awaiting') {
    logger.warn('page.recorded.ignored', { state: state.value })
    return
  }
  if (!machine.to('evaluating')) return
  // 先记住录音文件：转写失败时学生也能回听自己读的
  recordPath.value = clip.path || ''
  logger.info('page.recorded', { kb: Math.round(clip.base64.length / 1024), hasFile: !!clip.path })
  playingLabel.value = '正在转写与评价…'
  try {
    const lang = mode.value === '2.2' ? 'en' : 'zh'
    const text = await transcribe(clip.base64, lang)
    logger.info('page.transcribe.ok', { lang, chars: text.length })
    asrHint.value = text
    await judge(text, 'record')
  } catch (e) {
    logger.error('page.transcribe.fail', { msg: errText(e), code: (e as { code?: number }).code })
    // 转写失败不锁死作答方式：退回答题态，输入框一直可用
    machine.to('advancing')
    uni.showToast({ title: `录音识别失败：${errText(e) || '请改用输入框'}`, icon: 'none' })
    machine.reset(); machine.to('playing'); machine.to('awaiting')
  }
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
  countAttempt(result.score)
  practice.record({ wordId: w.id, word: w.word, score: result.score, result })
  // 默写时键盘占了下半屏，成绩卡默认会被挡住：出一成绩就滚到结果卡
  if (dictation.value) {
    void nextTick(() => {
      try { uni.pageScrollTo({ selector: '.result-card', duration: 200 }) } catch (_) { /* 老版本忽略 */ }
    })
  }
  await addRecord({
    id: newId('r'), word_id: w.id, mode: mode.value, input_type: inputType,
    raw_text: inputType === 'input' ? answer : '', asr_text: inputType === 'record' ? answer : '',
    // detail_json 带上默写标记：错词本按题溯源时能区分「默写」和语音作答
    score: result.score,
    detail_json: JSON.stringify(dictation.value ? { ...result, dictation: true } : result),
    created_at: Date.now(),
  })
  if (!machine.to('advancing')) return
  // 两种推进模式互斥：timer 只挂一个可取消计时器，submit 等用户点「下一条」
  advanceCtl.schedule()
}

/* ---------------- 结果卡回放：标准答案 / 我的录音 ---------------- */
/** 再点一次同一条 = 停止；切题 / 返回时由 cleanup 统一停。 */
function stopClip() {
  if (!playingClip.value) return
  playingClip.value = ''
  queue.stop()
}

/**
 * 回放标准答案：2.2 读英文单词，2.3 读中文释义（两种都是「标准答案」那一行）。
 * 走播放队列（带 TTS 缓存），所以返回上级会被立即打断。
 */
async function playExpectedClip() {
  if (playingClip.value === 'word') { stopClip(); return }
  const text = lastResult.value?.expected
    || (mode.value === '2.2' ? current.value?.word : current.value?.translation)
    || ''
  if (!text) return
  const lang: 'zh' | 'en' = mode.value === '2.2' ? 'en' : 'zh'
  // 定时推进模式下，学生既然要回听，就别让计时器在播放中把题目翻过去
  advanceCtl.cancel()
  stopClip()
  playingClip.value = 'word'
  logger.info('page.clip.expected', { lang, chars: text.length })
  try {
    await queue.playSegments([{ text, lang, label: lang === 'en' ? '英文' : '中文' }], {
      speed: settings.data.speed,
      volume: settings.data.volume,
    })
  } catch (e) {
    logger.warn('page.clip.expected.fail', { msg: errText(e) })
  } finally {
    if (playingClip.value === 'word') playingClip.value = ''
  }
}

/** 回放学生自己的录音（本地临时文件），和标准答案对比着听。 */
async function playMyClip() {
  if (playingClip.value === 'mine') { stopClip(); return }
  if (!recordPath.value) return
  advanceCtl.cancel()
  stopClip()
  playingClip.value = 'mine'
  logger.info('page.clip.mine', {})
  try {
    await queue.playLocal(recordPath.value, settings.data.volume)
  } catch (e) {
    logger.warn('page.clip.mine.fail', { msg: errText(e) })
  } finally {
    if (playingClip.value === 'mine') playingClip.value = ''
  }
}

function onRetry() {
  advanceCtl.cancel()
  interrupt()
  void runCurrent()
}

/**
 * 识别不对时改回输入框：不重播、不动掉已转写的文本（预填进去方便改一个字母），
 * 状态机仍走 idle → playing → awaiting，不新增旁路。
 */
function onTypeInstead() {
  if (!current.value) return
  advanceCtl.cancel()
  interrupt()
  lastResult.value = null
  typed.value = asrHint.value.replace(/[.\s]+$/, '').trim()
  machine.reset()
  if (!machine.to('playing')) return
  if (!machine.to('awaiting')) return
  playingLabel.value = '已切到输入框，改好拼写后点「提交」'
}

/**
 * 底部「取消」= 跳过本题：记 0 分并进入下一条（与「下一条」一样走 commitNow，
 * 一条题目内只会推进一次）。
 */
function onCancel() {
  const w = current.value
  if (!w) return
  logger.info('page.cancel', { wordId: w.id, state: state.value })
  countAttempt(0)
  practice.record({ wordId: w.id, word: w.word, score: 0, result: null })
  advanceCtl.commitNow()
}

function commitAdvance() { advanceCtl.commitNow() }

/** 底部「下一条」：只有出成绩后可用（没作答请走「取消」跳过），与结果卡「下一条」同一个入口 */
function onNextItem() {
  if (!lastResult.value) return
  advanceCtl.commitNow()
}

/** 键盘里的「上一条」：退回上一题重新作答（本次不记分，历史记录保留） */
function onPrevItem() {
  if (index.value <= 0) return
  logger.info('page.prev', { from: index.value, state: state.value })
  advanceCtl.cancel()
  interrupt()
  index.value--
  machine.reset()
  state.value = 'idle'
  void runCurrent()
}

function advance() {
  if (index.value >= words.value.length - 1) { finish(); return }
  index.value++
  machine.reset()
  state.value = 'idle'
  void runCurrent()
}

async function finish() {
  await saveSession()
  cleanup()
  const extra = dictation.value ? '&input=type' : ''
  uni.redirectTo({ url: `/pages/result/result?unitId=${unitId.value}&mode=${mode.value}${extra}` })
}
</script>

<style scoped>
.p-page { padding-top: 32rpx; }
/* 2.2 / 2.3 有底部录音条（取消 / 录音 / 下一条），默写有自定义键盘，都要留出等高空间 */
.p-page.has-mic-dock { padding-bottom: calc(330rpx + env(safe-area-inset-bottom)); }
.p-page.has-keyboard { padding-bottom: calc(560rpx + env(safe-area-inset-bottom)); }
.p-top { display: flex; align-items: flex-end; justify-content: space-between; }
.p-mode-wrap { display: flex; align-items: baseline; gap: 12rpx; }
.p-mode { font-size: 36rpx; font-weight: 700; }
.p-mode-sub { font-size: 23rpx; color: var(--elr-muted); }
.p-count { font-size: 26rpx; color: var(--elr-muted); }
.p-count-total { color: #c3c9d8; }
.p-track { height: 10rpx; background: #e8ecf5; border-radius: 999rpx; margin-top: 20rpx; overflow: hidden; }
.p-fill { height: 100%; background: linear-gradient(90deg, #fdba74, #f97316); border-radius: 999rpx; transition: width .3s ease; }
.p-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 14rpx; }
.p-unit { font-size: 23rpx; color: var(--elr-muted); max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-state { font-size: 22rpx; color: var(--elr-primary-dark); background: #fff1e3; border-radius: 999rpx; padding: 4rpx 16rpx; }

.word-card {
  background: #fff; border-radius: 36rpx; padding: 46rpx 34rpx 34rpx;
  margin: 26rpx 0 24rpx; text-align: center;
  box-shadow: 0 14rpx 40rpx rgba(27, 33, 48, .07);
}
.word-prompt { font-size: 23rpx; color: var(--elr-muted); letter-spacing: 1rpx; }
.word-main { display: block; font-size: 56rpx; font-weight: 700; line-height: 1.35; margin-top: 18rpx; word-break: break-word; }
.word-pos { display: inline-block; font-size: 22rpx; color: var(--elr-primary-dark); background: #fff1e3; border-radius: 8rpx; padding: 4rpx 14rpx; margin-top: 14rpx; }
.word-phonetic { display: block; font-size: 27rpx; color: var(--elr-muted); margin-top: 14rpx; }
.word-trans { display: block; font-size: 28rpx; color: #4a5164; margin-top: 16rpx; }
.play-state { display: flex; align-items: center; justify-content: center; gap: 10rpx; margin-top: 28rpx; }
.dot { width: 12rpx; height: 12rpx; border-radius: 50%; background: #c9cfdd; }
.dot.playing { background: var(--elr-primary); animation: blink 1s ease-in-out infinite; }
.dot.awaiting { background: var(--elr-ok); }
.dot.evaluating { background: var(--elr-warn); animation: blink 1s ease-in-out infinite; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.play-label { font-size: 22rpx; color: var(--elr-muted); }
.word-actions { display: flex; justify-content: center; margin-top: 24rpx; }

.controls { display: flex; align-items: flex-end; justify-content: center; gap: 34rpx; padding: 16rpx 0 8rpx; }
.ctrl { display: flex; flex-direction: column; align-items: center; gap: 10rpx; }
.ctrl:active { opacity: .7; }
.ctrl-icon {
  width: 100rpx; height: 100rpx; border-radius: 50%; background: #fff;
  color: var(--elr-primary-dark); font-size: 44rpx; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(27, 33, 48, .08);
}
.ctrl.primary .ctrl-icon {
  width: 132rpx; height: 132rpx; font-size: 54rpx; color: #fff;
  background: linear-gradient(135deg, #fb923c, #f97316);
  box-shadow: 0 14rpx 32rpx rgba(249, 115, 22, .34);
}
.ctrl-label { font-size: 22rpx; color: var(--elr-muted); }
.stop-btn { width: 100%; margin-top: 16rpx; }

.answer-card { background: #fff; border-radius: 32rpx; padding: 30rpx; margin-bottom: 24rpx; box-shadow: 0 10rpx 30rpx rgba(27, 33, 48, .06); }
.answer-title { display: block; font-size: 26rpx; font-weight: 600; margin-bottom: 18rpx; }
.answer-submit { width: 100%; margin-top: 18rpx; }

/* 默写的答案框：纯展示，不接收系统输入法 */
.typed-box {
  min-height: 92rpx; border-radius: 18rpx; padding: 22rpx 24rpx;
  background: #fdf7f2; border: 1rpx solid var(--elr-line);
  font-size: 34rpx; font-weight: 600; letter-spacing: 2rpx;
  color: #1f2637; word-break: break-all;
}
.typed-box.empty { font-size: 24rpx; font-weight: 400; letter-spacing: 0; color: #aab1c2; }

/* 2.2 只保留语音作答 */
.voice-box { background: #fdf7f2; border-radius: 18rpx; padding: 24rpx; }
.voice-title { display: block; font-size: 28rpx; font-weight: 600; color: #1f2637; }
.voice-sub { display: block; font-size: 22rpx; color: var(--elr-muted); line-height: 1.7; margin-top: 8rpx; }
.answer-tools { display: flex; align-items: center; justify-content: flex-end; gap: 34rpx; margin-top: 24rpx; }
.tool-link { font-size: 25rpx; color: var(--elr-primary-dark); }
.tool-link.muted { font-size: 21rpx; color: #b3bacb; }
.asr-box { margin-top: 16rpx; background: #fdf7f2; border-radius: 12rpx; padding: 12rpx 16rpx; }
.asr-hint { display: block; font-size: 24rpx; color: #3d4456; }
.asr-actions { display: flex; align-items: center; gap: 32rpx; margin-top: 10rpx; }
.asr-play { font-size: 23rpx; color: var(--elr-primary-dark); }
.asr-play.on { color: var(--elr-err); }
.answer-note { display: block; font-size: 21rpx; color: #b3bacb; margin-top: 14rpx; }

/* 底部固定录音条：按住说话，与上方输入框同时可用 */
.mic-dock {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  padding: 18rpx 28rpx calc(18rpx + env(safe-area-inset-bottom));
  background: rgba(247, 249, 255, .97);
  border-top: 1rpx solid var(--elr-line);
  box-shadow: 0 -8rpx 26rpx rgba(27, 33, 48, .05);
}
/* ---------------- 底部操作条样式 ---------------- */
.dock-bar { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.dock-mic { flex: 1; min-width: 0; display: flex; justify-content: center; }
/* 左右按钮等宽，保证中间录音钮始终居中 */
.dock-btn { width: 168rpx; padding: 18rpx 0; font-size: 26rpx; border-radius: 999rpx; }
/* 默写没有录音钮：两个按钮平分整条 */
.dock-bar.wide .dock-btn { flex: 1; width: auto; }
.log-panel { margin-bottom: 14rpx; background: #f5f0ea; border-radius: 16rpx; padding: 12rpx; }
.log-list { height: 360rpx; }
.log-line { display: block; font-size: 20rpx; line-height: 1.5; color: #3d4456; word-break: break-all; font-family: Menlo, Consolas, monospace; }
.log-actions { display: flex; justify-content: flex-end; gap: 32rpx; margin-top: 10rpx; }
</style>

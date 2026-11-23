<template>
  <view class="page study-page">
    <view v-if="article" class="doc-card">
      <text class="doc-title">{{ article.title }}</text>
      <view class="doc-meta">
        <text class="doc-meta-item">{{ article.sentences.length }} 句</text>
        <text class="doc-dot">·</text>
        <text class="doc-meta-item">{{ totalWords }} 词</text>
        <text v-if="checkedCount" class="doc-dot">·</text>
        <text v-if="checkedCount" class="doc-meta-item">已练 {{ checkedCount }} 句 · 平均 {{ avgScore }} 分</text>
      </view>
      <view class="doc-actions">
        <button class="btn btn-sm play-all" @click="playWhole">
          {{ playingKey === 'all' ? '■ 停止朗读' : '▶ 整段朗读' }}
        </button>
        <text class="doc-hint" @click="enterPhrase">长按单词 · 连读选词</text>
      </view>
      <view v-if="translating || needsTranslation" class="doc-zh">
        <text v-if="translating" class="doc-zh-hint">正在生成中文翻译…</text>
        <template v-else>
          <text class="doc-zh-hint">{{ zhError || '这篇文章还没有中文翻译' }}</text>
          <text class="doc-zh-action" @click="ensureTranslations(true)">生成翻译</text>
        </template>
      </view>
    </view>

    <!-- 正文：按句渲染，逐词可点 -->
    <view v-if="article" class="passage-card">
      <view
        v-for="(sentence, si) in article.sentences" :key="si"
        class="sentence"
        :class="{ active: activeSentence === si, playing: playingKey === `s:${si}` || (playingKey === 'all' && activeSentence === si) }"
      >
        <view class="s-head">
          <text class="s-idx">{{ si + 1 }}</text>
          <text class="s-play" :class="{ on: playingKey === `s:${si}` }" @click="playSentence(si)">
            {{ playingKey === `s:${si}` ? '■' : '▶' }}
          </text>
          <text v-if="hasScore(si)" class="s-score" :class="scoreClass(scores[si])">{{ scores[si] }} 分</text>
          <text v-if="activeSentence !== si" class="s-pick" @click="selectSentence(si)">练这句</text>
          <text v-else class="s-picked">正在练</text>
        </view>

        <view class="s-text">
          <view
            v-for="(tok, ti) in tokensBySentence[si]" :key="ti"
            class="tok"
            :class="[wordStatus(si, tok.wi), { on: playingKey === `w:${si}:${tok.wi}`, sel: selectedKey === `${si}:${tok.wi}`, pick: isPicked(si, tok.wi) }]"
            @click="onWordTap(si, tok)"
            @longpress="startPhrase(si, tok)"
          >{{ tok.text }}</view>
        </view>

        <text v-if="translations[si]" class="s-zh">{{ translations[si] }}</text>

        <text v-if="lastIndex === si && lastEval" class="s-mark-note">标记：绿色读对 · 黄色近似 · 红色漏读</text>
      </view>
    </view>

    <!-- 检查中 -->
    <view v-if="checking" class="card checking-card">
      <view class="spinner" />
      <text class="checking-title">正在识别你的朗读</text>
      <text class="checking-sub">先转写成文字，再与第 {{ activeSentence + 1 }} 句逐词对齐</text>
    </view>

    <!-- 检查失败：至少能回听刚录的音 -->
    <view v-if="recordError && !checking" class="card err-card">
      <text class="err-title">这次没有检查成功</text>
      <text class="err-sub">{{ recordError }}</text>
      <view class="res-actions">
        <text v-if="recordPath" class="res-btn" :class="{ on: playingKey === 'mine' }" @click="playMine">
          {{ playingKey === 'mine' ? '■ 停止' : '▶ 回放我的录音' }}
        </text>
        <text class="res-btn" @click="dismissError">知道了</text>
      </view>
    </view>

    <!-- 本句结果 -->
    <view v-if="lastEval && !checking" class="card result-card">
      <view class="res-top">
        <view class="res-score-wrap">
          <text class="res-score" :class="scoreClass(lastEval.score)">{{ lastEval.score }}</text>
          <text class="res-unit">分</text>
        </view>
        <view class="res-main">
          <text class="res-sentence">第 {{ lastIndex + 1 }} 句 · 内容正确度</text>
          <text class="res-sub">读对 {{ readCount }} / {{ lastEval.total }} 词<text v-if="lastEval.semantic"> · 已结合语义判断</text></text>
        </view>
      </view>

      <text class="res-feedback">{{ lastEval.feedback }}</text>

      <view class="res-chips">
        <text
          v-for="(w, wi) in lastEval.words" :key="wi"
          class="chip-word" :class="w.status"
        >{{ w.text }}</text>
        <text v-for="(x, xi) in lastEval.extra" :key="'x' + xi" class="chip-word extra">+{{ x }}</text>
      </view>

      <view class="res-trans">
        <text class="res-label">语音识别</text>
        <text class="res-text">{{ lastEval.answer || '（没有识别到内容，可以离麦克风近一点再读）' }}</text>
      </view>

      <view class="res-actions">
        <text class="res-btn" :class="{ on: playingKey === `s:${lastIndex}` }" @click="playSentence(lastIndex)">
          {{ playingKey === `s:${lastIndex}` ? '■ 停止' : '▶ 听原句' }}
        </text>
        <text v-if="recordPath" class="res-btn" :class="{ on: playingKey === 'mine' }" @click="playMine">
          {{ playingKey === 'mine' ? '■ 停止' : '▶ 我的录音' }}
        </text>
        <text class="res-btn" @click="retrySentence">再读一次</text>
        <text v-if="hasNext" class="res-btn primary" @click="nextSentence">下一句</text>
      </view>
    </view>

    <!-- 连读选择条：长按单词进入，多选后把整段交给合成，连读变音更自然 -->
    <view v-if="article && phraseMode" class="phrase-bar">
      <view class="phrase-info">
        <text class="phrase-count">已选 {{ pickedWords.length }} 个单词</text>
        <text class="phrase-text">{{ pickedText || '点单词选择要连读的片段' }}</text>
      </view>
      <text class="phrase-cancel" @click="exitPhrase">取消</text>
      <button class="btn btn-sm phrase-play" :disabled="!pickedWords.length" @click="playPhrase">
        {{ playingKey === 'phrase' ? '■ 停止' : '▶ 连读' }}
      </button>
    </view>

    <!-- 底部录音条：左边显示点选的单词（单词 / 音标 / 翻译），右边是录音钮 -->
    <view v-if="article" class="dock">
      <view class="dock-info">
        <template v-if="selectedWord">
          <view class="wi-head">
            <text class="wi-word">{{ selectedWord.word }}</text>
            <text v-if="selectedWord.phonetic" class="wi-phon">{{ selectedWord.phonetic }}</text>
          </view>
          <text class="wi-trans" :class="{ dim: !selectedWord.translation }">{{ wordInfoText }}</text>
        </template>
      </view>
      <view class="dock-mic">
        <RecorderButton
          label="按住跟读"
          hint="一句一录；读错可以重录"
          hide-hint
          :busy="checking"
          @start="onRecordStart"
          @recorded="onRecorded"
        />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onBackPress, onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import RecorderButton from '@/components/RecorderButton.vue'
import { useSettingsStore } from '@/store/settings'
import { evaluatePassage, playQueue, transcribe } from '@/services'
import {
  addReadRecord, addStudySession, getArticle, latestSentenceScores, newId, updateArticleTranslations,
} from '@/services/storage'
import { lookupGlosses } from '@/services/dictionary'
import { translateSentences } from '@/services/passage-translate'
import { cloudAvailable } from '@/api/runtime-config'
import { countWords } from '@/services/passage'
import { errText, logger } from '@/utils/log'
import type { PassageEval, ReadArticle } from '@/services/types'

const settings = useSettingsStore()

const article = ref<ReadArticle | null>(null)
const scores = ref<Record<number, number>>({})
const activeSentence = ref(0)
const playingKey = ref('')
const checking = ref(false)
const recordPath = ref('')
const recordError = ref('')
const lastEval = ref<PassageEval | null>(null)
const lastIndex = ref(-1)

/* 点词释义：底部左边显示单词 / 音标 / 翻译。
   速度：切句时把该句单词合并成一次速览请求预取（同时命中词库 / 本地速览缓存），点词基本即时。 */
interface WordBriefView { word: string; phonetic: string; translation: string }
const selectedWord = ref<WordBriefView | null>(null)
const selectedKey = ref('')
const wordLoading = ref(false)
const wordError = ref('')
/** 已拿到的速览：key = 小写单词 */
const glossMap = ref<Record<string, WordBriefView>>({})
let wordToken = 0

/* 连读：长按单词进入多选，选中的词按原文顺序拼成一段整体合成（连读 / 变音交给 TTS） */
interface PickedWord { key: string; si: number; wi: number; word: string }
const phraseMode = ref(false)
const pickedWords = ref<PickedWord[]>([])
/** 长按之后浏览器还会补一个 click，用它压掉误触发 */
let longPressAt = 0

const pickedText = computed(() =>
  [...pickedWords.value]
    .sort((a, b) => a.si - b.si || a.wi - b.wi)
    .map((p) => p.word)
    .join(' '),
)

function isPicked(si: number, wi: number): boolean {
  return pickedWords.value.some((p) => p.si === si && p.wi === wi)
}

function togglePick(si: number, tok: Tok) {
  const key = `${si}:${tok.wi}`
  if (pickedWords.value.some((p) => p.key === key)) {
    pickedWords.value = pickedWords.value.filter((p) => p.key !== key)
  } else {
    pickedWords.value = [...pickedWords.value, { key, si, wi: tok.wi, word: tok.word }]
  }
}

function exitPhrase() {
  phraseMode.value = false
  pickedWords.value = []
  if (playingKey.value === 'phrase') interrupt()
}

/** 顶部「连读选词」入口：不依赖长按也能进多选（桌面端 / 不习惯长按的用户） */
function enterPhrase() {
  if (phraseMode.value) return
  phraseMode.value = true
  interrupt()
  clearWordInfo()
  logger.debug('page.read.phrase.enter', {})
}

/** 长按单词：进入（或退出）该词的连读多选 */
function startPhrase(si: number, tok: Tok) {
  if (!tok.word) return
  longPressAt = Date.now()
  if (!phraseMode.value) {
    phraseMode.value = true
    interrupt()
    clearWordInfo()
  }
  activeSentence.value = si
  togglePick(si, tok)
  logger.debug('page.read.phrase.pick', { sentence: si, picked: pickedWords.value.length })
}

/** 单词点击：普通模式听单词 / 连读模式切换选中 */
function onWordTap(si: number, tok: Tok) {
  if (!tok.word) return
  if (Date.now() - longPressAt < 400) return
  if (phraseMode.value) { togglePick(si, tok); return }
  void playWord(si, tok)
}

/** 连读：把选中的词按原文顺序交给队列，一次合成、一次播放 */
async function playPhrase() {
  const text = pickedText.value
  if (!text) return
  if (playingKey.value === 'phrase') { interrupt(); return }
  interrupt()
  const token = runToken
  playingKey.value = 'phrase'
  logger.info('page.read.play.phrase', { words: pickedWords.value.length, chars: text.length })
  try {
    await playQueue.playSegments([{ text, lang: 'en', label: '连读' }], speakOpts())
  } catch (e) {
    logger.warn('page.read.play.phrase.fail', { msg: errText(e) })
  } finally {
    if (token === runToken && playingKey.value === 'phrase') playingKey.value = ''
  }
}

const wordInfoText = computed(() => {
  const info = selectedWord.value
  if (!info) return ''
  if (info.translation) return info.translation
  if (wordLoading.value) return '正在查询释义…'
  if (wordError.value) return wordError.value
  return '词典未收录这个词'
})

/** 每次重新播放递增：旧的异步协程据此失效，避免叠播与状态互相覆盖 */
let runToken = 0

interface Tok { text: string; word: string; wi: number }

/** 标点跟随前一个单词显示；单词的 wi 与评分结果里的 words 下标一一对应。 */
function buildTokens(sentence: string): Tok[] {
  const out: Tok[] = []
  const re = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|[^A-Za-z0-9]+/g
  let m: RegExpExecArray | null
  let wi = 0
  while ((m = re.exec(sentence)) !== null) {
    const piece = m[0]
    if (/^[A-Za-z0-9]/.test(piece)) out.push({ text: piece, word: piece, wi: wi++ })
    else if (out.length) out[out.length - 1].text += piece
    else out.push({ text: piece, word: '', wi: -1 })
  }
  return out
}

const tokensBySentence = computed(() => (article.value?.sentences || []).map(buildTokens))
const translations = computed(() => article.value?.translations || [])
/** 整篇都没有译文（老文章 / 添加时断网）：显示补翻译入口 */
const needsTranslation = computed(() =>
  !!article.value && article.value.sentences.length > 0 && !article.value.translations.some(Boolean),
)
const translating = ref(false)
const zhError = ref('')

/* ---------------- 学习记录：本次跟读会话的时长与检查情况 ---------------- */
let readStart = 0
const readScores: number[] = []
let readSaved = false

async function saveReadSession() {
  const a = article.value
  if (!a || readSaved || !readStart) return
  const elapsed = Math.round((Date.now() - readStart) / 1000)
  if (elapsed < 10 && !readScores.length) return
  readSaved = true
  const sum = readScores.reduce((x, y) => x + y, 0)
  try {
    await addStudySession({
      id: newId('ss'),
      kind: 'read',
      mode: 'read',
      unit_id: a.id,
      title: a.title,
      started_at: readStart,
      ended_at: Date.now(),
      duration_sec: elapsed,
      total: a.sentences.length,
      answered: readScores.length,
      passed: readScores.filter((s) => s >= 60).length,
      avg_score: readScores.length ? Math.round(sum / readScores.length) : 0,
      created_at: Date.now(),
    })
  } catch (e) {
    logger.warn('page.read.session.fail', { msg: errText(e) })
  }
}

function resetReadSession() {
  readStart = Date.now()
  readScores.length = 0
}
const totalWords = computed(() => countWords(article.value?.sentences || []))
const checkedCount = computed(() => Object.keys(scores.value).length)
const avgScore = computed(() => {
  const values = Object.values(scores.value)
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
})
const readCount = computed(() =>
  lastEval.value ? lastEval.value.words.filter((w) => w.status !== 'missed').length : 0,
)
const hasNext = computed(() => {
  const len = article.value?.sentences.length || 0
  return lastIndex.value >= 0 && lastIndex.value < len - 1
})

function hasScore(si: number) { return scores.value[si] !== undefined }
function scoreClass(score: number) { return score >= 85 ? 'good' : score >= 60 ? 'mid' : 'low' }
function wordStatus(si: number, wi: number): string {
  if (lastIndex.value !== si || !lastEval.value || wi < 0) return ''
  return lastEval.value.words[wi]?.status || ''
}

onLoad(async (q) => {
  await settings.load()
  const id = String(q?.articleId || '')
  if (!id) {
    uni.showToast({ title: '缺少文章参数', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }
  try {
    const a = await getArticle(id)
    if (!a || !a.sentences.length) {
      uni.showToast({ title: '文章不存在或没有可读句子', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 600)
      return
    }
    article.value = a
    resetReadSession()
    scores.value = await latestSentenceScores(id)
    const firstUnchecked = a.sentences.findIndex((_, i) => scores.value[i] === undefined)
    activeSentence.value = firstUnchecked >= 0 ? firstUnchecked : 0
    logger.info('page.read.load', {
      sentences: a.sentences.length, checked: Object.keys(scores.value).length, start: activeSentence.value,
    })
    // 当前句一开始就预取释义：点词时通常已经是本地命中
    warmSentences(activeSentence.value)
    // 老文章 / 添加时断网：打开后自动补一次逐句中文翻译
    void ensureTranslations(false)
  } catch (e) {
    logger.error('page.read.load.fail', { msg: errText(e) })
    uni.showToast({ title: '读取文章失败', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
  }
})

onHide(() => cleanup())
onUnload(() => cleanup())
/** 从后台 / 其他页面回来：上一段已落库，重新开始计时 */
onShow(() => {
  if (readSaved && article.value) {
    readSaved = false
    resetReadSession()
  }
})
onBackPress(() => { cleanup(); return false })

function cleanup() {
  runToken++
  playQueue.stop()
  playingKey.value = ''
  exitPhrase()
  clearWordInfo()
  void saveReadSession()
}

function interrupt() {
  runToken++
  playQueue.stop()
  playingKey.value = ''
}

/* ---------------- 播放：整段 / 单句 / 单词 / 我的录音 ---------------- */

const speakOpts = () => ({
  speed: settings.data.speed,
  volume: settings.data.volume,
  accent: settings.data.accent,
})

async function playWhole() {
  if (playingKey.value === 'all') { interrupt(); return }
  const list = article.value?.sentences || []
  if (!list.length) return
  if (phraseMode.value) exitPhrase()
  interrupt()
  const token = runToken
  playingKey.value = 'all'
  logger.info('page.read.play.all', { sentences: list.length })
  try {
    await playQueue.playSegments(
      list.map((text, i) => ({ text, lang: 'en' as const, label: `第 ${i + 1} 句` })),
      {
        ...speakOpts(),
        onSegStart: (_seg, i) => { activeSentence.value = i },
      },
    )
  } catch (e) {
    logger.warn('page.read.play.all.fail', { msg: errText(e) })
  } finally {
    if (token === runToken && playingKey.value === 'all') playingKey.value = ''
  }
}

async function playSentence(si: number) {
  const text = article.value?.sentences[si]
  if (!text) return
  const key = `s:${si}`
  if (playingKey.value === key) { interrupt(); return }
  if (phraseMode.value) exitPhrase()
  interrupt()
  activeSentence.value = si
  const token = runToken
  playingKey.value = key
  try {
    await playQueue.playSegments([{ text, lang: 'en', label: '本句' }], speakOpts())
  } catch (e) {
    logger.warn('page.read.play.sentence.fail', { msg: errText(e) })
  } finally {
    if (token === runToken && playingKey.value === key) playingKey.value = ''
  }
}

async function playWord(si: number, tok: Tok) {
  if (!tok.word) return
  const key = `w:${si}:${tok.wi}`
  // 先选中并查释义：词库 / 缓存命中时是即时的，不阻塞朗读
  if (selectedKey.value !== `${si}:${tok.wi}` || wordError.value) void showWordInfo(si, tok)
  if (playingKey.value === key) { interrupt(); return }
  interrupt()
  activeSentence.value = si
  const token = runToken
  playingKey.value = key
  logger.debug('page.read.play.word', { sentence: si, wordChars: tok.word.length })
  try {
    await playQueue.playSegments([{ text: tok.word, lang: 'en', label: '单词' }], speakOpts())
  } catch (e) {
    logger.warn('page.read.play.word.fail', { msg: errText(e) })
  } finally {
    if (token === runToken && playingKey.value === key) playingKey.value = ''
  }
}

/** 生成整篇逐句中文：老文章或添加时断网时用；成功后写回 read_article.translations */
async function ensureTranslations(manual: boolean) {
  const a = article.value
  if (!a || translating.value || !needsTranslation.value) return
  if (!cloudAvailable()) {
    if (manual) uni.showToast({ title: '当前无法联网，稍后再试', icon: 'none' })
    return
  }
  translating.value = true
  zhError.value = ''
  try {
    const zh = await translateSentences(a.sentences)
    const merged = a.sentences.map((_, i) => zh[i] || '')
    await updateArticleTranslations(a.id, merged)
    article.value = { ...a, translations: merged }
    logger.info('page.read.translate.ok', { sentences: merged.length, translated: merged.filter(Boolean).length })
  } catch (e) {
    zhError.value = errText(e) || '中文翻译失败，点右侧重试'
    logger.warn('page.read.translate.fail', { msg: zhError.value })
    if (manual) uni.showToast({ title: zhError.value, icon: 'none' })
  } finally {
    translating.value = false
  }
}

/** 点词释义：先看已预取的速览（即时），没有就单独查一次；结果只保留单词 / 音标 / 翻译。 */
async function showWordInfo(si: number, tok: Tok) {
  const key = tok.word.toLowerCase()
  selectedKey.value = `${si}:${tok.wi}`
  const cached = glossMap.value[key]
  if (cached) {
    selectedWord.value = cached
    wordLoading.value = false
    wordError.value = ''
    return
  }
  const token = ++wordToken
  selectedWord.value = { word: tok.word, phonetic: '', translation: '' }
  wordLoading.value = true
  wordError.value = ''
  try {
    const [hit] = await lookupGlosses([tok.word], { accent: settings.data.accent })
    if (token !== wordToken) return
    if (hit) {
      const view = { word: hit.word, phonetic: hit.phonetic, translation: hit.brief }
      glossMap.value[key] = view
      selectedWord.value = view
      logger.debug('page.read.gloss', { source: hit.source, hasPhonetic: !!hit.phonetic })
    }
  } catch (e) {
    if (token !== wordToken) return
    wordError.value = errText(e) || '释义查询失败，点词可重试'
    logger.warn('page.read.gloss.fail', { msg: errText(e) })
  } finally {
    if (token === wordToken) wordLoading.value = false
  }
}

/**
 * 释义预热：把「当前句 + 下一句」里还没有速览的单词合并成**一次**请求（最多 10 个）。
 * 本地词库 / 本地速览缓存先命中，不消耗额度；失败静默，点词时还会再试。
 * 合并成一条是为了不让两个请求在服务端排队（X2.6 单次约 4s）。
 */
let warmBusy = false
let warmTarget = -1

function collectGlossWords(si: number, out: string[], seen: Set<string>) {
  for (const t of tokensBySentence.value[si] || []) {
    if (!t.word) continue
    const key = t.word.toLowerCase()
    if (glossMap.value[key] || seen.has(key)) continue
    seen.add(key)
    out.push(t.word)
    if (out.length >= 10) return
  }
}

async function prefetchPair(si: number) {
  const words: string[] = []
  const seen = new Set<string>()
  collectGlossWords(si, words, seen)
  if (words.length < 10) collectGlossWords(si + 1, words, seen)
  if (!words.length) return
  try {
    const list = await lookupGlosses(words, { accent: settings.data.accent })
    for (const g of list) {
      glossMap.value[g.word.toLowerCase()] = { word: g.word, phonetic: g.phonetic, translation: g.brief }
    }
    logger.debug('page.read.gloss.prefetch', { sentence: si, asked: words.length, got: list.length })
  } catch (e) {
    logger.warn('page.read.gloss.prefetch.fail', { sentence: si, msg: errText(e) })
  }
}

/** 切句时排队预热；上一次还在跑就先记下目标，跑完再补一次，避免漏句 */
function warmSentences(si: number) {
  warmTarget = si
  if (warmBusy) return
  warmBusy = true
  void (async () => {
    try {
      while (warmTarget >= 0) {
        const target = warmTarget
        warmTarget = -1
        await prefetchPair(target)
      }
    } finally {
      warmBusy = false
    }
  })()
}

/** 切句 / 整段朗读换句时预热释义 */
watch(activeSentence, (si) => {
  if (article.value) warmSentences(si)
})

async function playMine() {
  if (playingKey.value === 'mine') { interrupt(); return }
  if (!recordPath.value) return
  interrupt()
  const token = runToken
  playingKey.value = 'mine'
  try {
    await playQueue.playLocal(recordPath.value, settings.data.volume)
  } catch (e) {
    logger.warn('page.read.play.mine.fail', { msg: errText(e) })
  } finally {
    if (token === runToken && playingKey.value === 'mine') playingKey.value = ''
  }
}

/* ---------------- 录音 → 转写 → 逐词检查 ---------------- */

function onRecordStart() {
  // 学生开始朗读就停掉正在放的朗读，避免把自己的声音和 TTS 叠在一起
  interrupt()
  recordError.value = ''
}

function selectSentence(si: number) {
  if (si === activeSentence.value) return
  interrupt()
  exitPhrase()
  clearWordInfo()
  activeSentence.value = si
  lastEval.value = null
  lastIndex.value = -1
  recordPath.value = ''
  recordError.value = ''
}

function clearWordInfo() {
  wordToken++
  selectedWord.value = null
  selectedKey.value = ''
  wordLoading.value = false
  wordError.value = ''
}

function retrySentence() {
  interrupt()
  lastEval.value = null
  lastIndex.value = -1
  recordPath.value = ''
  recordError.value = ''
}

function dismissError() { recordError.value = '' }

function nextSentence() {
  const len = article.value?.sentences.length || 0
  const si = lastIndex.value >= 0 ? lastIndex.value : activeSentence.value
  if (si >= len - 1) return
  selectSentence(si + 1)
}

async function onRecorded(clip: { base64: string; path: string }) {
  const a = article.value
  if (!a || checking.value) return
  const si = activeSentence.value
  const sentence = a.sentences[si]
  if (!sentence) return
  recordPath.value = clip.path || ''
  checking.value = true
  recordError.value = ''
  logger.info('page.read.recorded', {
    sentence: si, kb: Math.round(clip.base64.length / 1024), hasFile: !!clip.path,
  })
  try {
    const text = await transcribe(clip.base64, 'en')
    logger.info('page.read.transcribe.ok', { chars: text.length })
    const result = await evaluatePassage(sentence, text)
    lastEval.value = result
    lastIndex.value = si
    scores.value = { ...scores.value, [si]: result.score }
    readScores.push(result.score)
    await addReadRecord({
      id: newId('rr'),
      article_id: a.id,
      sentence_index: si,
      asr_text: result.answer,
      score: result.score,
      detail_json: JSON.stringify(result),
      created_at: Date.now(),
    })
    logger.info('page.read.eval.ok', {
      sentence: si, score: result.score, words: result.total, semantic: result.semantic,
    })
  } catch (e) {
    logger.error('page.read.recorded.fail', { msg: errText(e), code: (e as { code?: number }).code })
    recordError.value = errText(e) || '语音识别失败，请重试'
    uni.showToast({ title: `朗读检查失败：${recordError.value}`, icon: 'none' })
  } finally {
    checking.value = false
  }
}
</script>

<style scoped>
.study-page { padding-top: 24rpx; padding-bottom: calc(300rpx + env(safe-area-inset-bottom)); }

.doc-card {
  background: #fff; border-radius: 28rpx; padding: 30rpx;
  box-shadow: 0 8rpx 30rpx rgba(27, 33, 48, .06);
}
.doc-title { display: block; font-size: 36rpx; font-weight: 700; line-height: 1.4; }
.doc-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8rpx; margin-top: 12rpx; }
.doc-meta-item { font-size: 23rpx; color: var(--elr-muted); }
.doc-dot { font-size: 22rpx; color: #c3c9d8; }
.doc-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 22rpx; }
.play-all { background: var(--elr-primary); color: #fff; }
.doc-hint { font-size: 21rpx; color: #aab1c2; }
.doc-zh {
  display: flex; align-items: center; justify-content: space-between; gap: 16rpx;
  margin-top: 16rpx; padding: 12rpx 18rpx;
  background: #fdf7f2; border-radius: 12rpx;
}
.doc-zh-hint { font-size: 21rpx; color: #8a93a8; line-height: 1.5; }
.doc-zh-action { font-size: 22rpx; color: var(--elr-primary-dark); flex-shrink: 0; }

.passage-card {
  background: #fff; border-radius: 28rpx; padding: 12rpx 22rpx;
  margin-top: 22rpx; box-shadow: 0 8rpx 30rpx rgba(27, 33, 48, .06);
}
.sentence {
  padding: 20rpx 0; border-bottom: 1rpx solid var(--elr-line);
  border-radius: 16rpx; transition: background .2s;
}
.sentence:last-child { border-bottom: none; }
.sentence.active { background: #f8faff; }
.sentence.playing { background: #fff1e3; }
.s-head { display: flex; align-items: center; gap: 14rpx; }
.s-idx {
  width: 38rpx; height: 38rpx; border-radius: 50%; flex-shrink: 0;
  background: #fff1e3; color: var(--elr-primary-dark); font-size: 21rpx;
  display: flex; align-items: center; justify-content: center;
}
.s-play {
  width: 48rpx; height: 48rpx; border-radius: 50%; flex-shrink: 0;
  background: #faf5f0; color: var(--elr-primary-dark); font-size: 20rpx;
  display: flex; align-items: center; justify-content: center;
}
.s-play.on { background: var(--elr-primary); color: #fff; }
.s-score { font-size: 21rpx; border-radius: 999rpx; padding: 3rpx 14rpx; }
.s-score.good { color: #0f9d63; background: #e9f9f1; }
.s-score.mid { color: #b45309; background: #fff4e5; }
.s-score.low { color: #dc2626; background: #fdeceb; }
.s-pick { margin-left: auto; font-size: 22rpx; color: var(--elr-primary-dark); }
.s-picked { margin-left: auto; font-size: 21rpx; color: #0f9d63; background: #e9f9f1; border-radius: 999rpx; padding: 3rpx 14rpx; }

.s-text {
  display: flex; flex-wrap: wrap; align-items: baseline;
  font-size: 34rpx; line-height: 1.95; margin-top: 10rpx; color: #1f2637;
}
.tok { white-space: pre-wrap; border-radius: 6rpx; padding: 0 2rpx; border-bottom: 3rpx solid transparent; }
.tok.sel { background: #fff1e3; color: var(--elr-primary-dark); }
.tok.pick { background: #fff4e5; color: #b45309; }
.tok.on { background: #ffe0c2; color: var(--elr-primary-dark); }
.tok.ok { color: #0f9d63; }
.tok.near { color: #b45309; }
.tok.missed { color: #dc2626; text-decoration: line-through; }
.s-zh { display: block; font-size: 1.2rem; color: #8a93a8; line-height: 1.7; margin-top: 6rpx; }
.s-mark-note { display: block; font-size: 20rpx; color: #aab1c2; margin-top: 8rpx; }

.checking-card { display: flex; flex-direction: column; align-items: center; padding: 40rpx 32rpx; margin-top: 22rpx; }
.spinner {
  width: 44rpx; height: 44rpx; border-radius: 50%;
  border: 5rpx solid #ffe0c2; border-top-color: var(--elr-primary-dark);
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg) } }
.checking-title { font-size: 28rpx; font-weight: 600; margin-top: 18rpx; }
.checking-sub { font-size: 22rpx; color: var(--elr-muted); margin-top: 8rpx; }

.err-card { margin-top: 22rpx; background: #fff8ec; border: 1rpx solid #f7e6c8; box-shadow: none; }
.err-title { display: block; font-size: 27rpx; font-weight: 600; color: #a26a12; }
.err-sub { display: block; font-size: 23rpx; color: #a26a12; line-height: 1.6; margin-top: 8rpx; word-break: break-all; }

.result-card { margin-top: 22rpx; }
.res-top { display: flex; align-items: center; gap: 24rpx; }
.res-score-wrap { display: flex; align-items: baseline; }
.res-score { font-size: 68rpx; font-weight: 700; line-height: 1; }
.res-score.good { color: #10b981; }
.res-score.mid { color: #f59e0b; }
.res-score.low { color: var(--elr-err); }
.res-unit { font-size: 24rpx; color: var(--elr-muted); margin-left: 6rpx; }
.res-main { flex: 1; min-width: 0; }
.res-sentence { display: block; font-size: 27rpx; font-weight: 600; }
.res-sub { display: block; font-size: 22rpx; color: var(--elr-muted); margin-top: 6rpx; }
.res-feedback { display: block; font-size: 26rpx; color: #3d4456; line-height: 1.7; margin-top: 16rpx; }
.res-chips { display: flex; flex-wrap: wrap; gap: 10rpx; margin-top: 16rpx; }
.chip-word { font-size: 23rpx; border-radius: 8rpx; padding: 5rpx 14rpx; background: #faf5f0; color: #47506a; }
.chip-word.ok { color: #0f9d63; background: #e9f9f1; }
.chip-word.near { color: #b45309; background: #fff4e5; }
.chip-word.missed { color: #dc2626; background: #fdeceb; }
.chip-word.extra { color: #7c5cf0; background: #f2eeff; }
.res-trans { margin-top: 16rpx; background: #fdf7f2; border-radius: 12rpx; padding: 12rpx 16rpx; }
.res-label { display: block; font-size: 20rpx; color: #aab1c2; }
.res-text { display: block; font-size: 24rpx; color: #3d4456; line-height: 1.6; margin-top: 4rpx; }
.res-actions { display: flex; flex-wrap: wrap; gap: 26rpx; margin-top: 20rpx; }
.res-btn { font-size: 24rpx; color: var(--elr-primary-dark); }
.res-btn.on { color: var(--elr-err); }
.res-btn.primary { color: #0f9d63; font-weight: 600; }

/* 连读选择条：浮在底部录音条上方，不遮挡正文 */
.phrase-bar {
  position: fixed; left: 20rpx; right: 20rpx; z-index: 25;
  bottom: calc(190rpx + env(safe-area-inset-bottom));
  display: flex; align-items: center; gap: 16rpx;
  background: #fff; border: 1rpx solid var(--elr-line); border-radius: 999rpx;
  padding: 12rpx 16rpx 12rpx 24rpx;
  box-shadow: 0 10rpx 30rpx rgba(27, 33, 48, .14);
}
.phrase-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.phrase-count { font-size: 21rpx; color: var(--elr-muted); }
.phrase-text {
  font-size: 23rpx; color: #1f2637; margin-top: 4rpx;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.phrase-cancel { font-size: 23rpx; color: var(--elr-muted); flex-shrink: 0; padding: 6rpx 4rpx; }
.phrase-play {
  flex-shrink: 0; margin: 0; padding: 12rpx 24rpx; font-size: 24rpx;
  background: var(--elr-primary); color: #fff;
}
.phrase-play[disabled] { opacity: .45; }

.dock {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  display: flex; align-items: center; gap: 22rpx;
  padding: 16rpx 30rpx calc(14rpx + env(safe-area-inset-bottom));
  background: rgba(247, 249, 255, .97);
  border-top: 1rpx solid var(--elr-line);
  box-shadow: 0 -8rpx 26rpx rgba(27, 33, 48, .06);
}
.dock-info { flex: 1 1 auto; min-width: 300rpx; display: flex; flex-direction: column; justify-content: center; }
.wi-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6rpx 12rpx; min-width: 0; }
.wi-word {
  max-width: 100%; font-size: 36rpx; font-weight: 700; color: #1f2637;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wi-phon { font-size: 36rpx; color: red;white-space: nowrap; font-weight: 500; }
.wi-trans {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow: hidden; font-size: 32rpx; color: #3d4456; line-height: 1.5; margin-top: 6rpx;
}
.wi-trans.dim { color: var(--elr-muted); }
.dock-mic { flex: 0 1 auto; max-width: 320rpx; }
</style>

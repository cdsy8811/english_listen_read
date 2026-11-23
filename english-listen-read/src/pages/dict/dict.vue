<template>
  <view class="page dict-page">
    <!-- 顶部搜索 -->
    <view class="hero">
      <view class="glow glow-a" />
      <view class="glow glow-b" />
      <view class="hero-top">
        <view class="hero-copy">
          <text class="hero-kicker">DICTIONARY · 中英互查</text>
          <text class="hero-title">电子词典</text>
          <text class="hero-sub">查释义、听发音、看例句，好词一键收进生词本</text>
        </view>
        <view class="hero-mark">Aa</view>
      </view>

      <view class="search-box">
        <view class="search-icon">
          <view class="search-lens" />
          <view class="search-handle" />
        </view>
        <input
          v-model="keyword"
          class="search-input"
          confirm-type="search"
          placeholder="输入英文单词 / 中文释义"
          @confirm="onSearch"
        />
        <view v-if="keyword" class="search-clear" @click="onClearKeyword">×</view>
        <view class="search-go" :class="{ busy: loading }" @click="onSearch">
          {{ loading ? '查询中' : '查词' }}
        </view>
      </view>

      <view class="hero-tags">
        <text class="hero-tag">中 → 英</text>
        <text class="hero-tag">英 → 中</text>
        <text class="hero-tag">US / UK 发音</text>
        <text class="hero-tag">离线缓存</text>
      </view>
    </view>

    <!-- 最近查询 -->
    <view v-if="history.length" class="card hist-card">
      <view class="row">
        <text class="block-title">最近查询</text>
        <text class="mini-link" @click="onClearHistory">清空</text>
      </view>
      <view class="hist-list">
        <text
          v-for="h in history" :key="h.id"
          class="hist-chip"
          :class="{ active: h.query === result?.query || h.query === keyword }"
          @click="runSearch(h.query)"
        >{{ h.query }}</text>
      </view>
    </view>

    <!-- 加载中 -->
    <view v-if="loading" class="card state-card">
      <view class="spinner" />
      <text class="state-title">正在查「{{ pendingQuery }}」</text>
      <text class="state-sub">首次查询走云端词典，查过即缓存，断网也能复看</text>
    </view>

    <!-- 我的词库命中 -->
    <view v-if="localHits.length" class="card">
      <view class="row">
        <text class="block-title">我的词库</text>
        <text class="section-more">命中 {{ localHits.length }} 条</text>
      </view>
      <view v-for="w in localHits" :key="w.id" class="local-item" @click="openLocal(w)">
        <view class="local-main">
          <view class="local-line">
            <text class="local-word">{{ w.word }}</text>
            <text v-if="w.phonetic_us || w.phonetic_uk" class="local-phon">{{ w.phonetic_us || w.phonetic_uk }}</text>
            <text v-if="w.pos" class="pos-tag">{{ w.pos }}</text>
            <text v-if="w.wrong" class="wrong-tag">错词</text>
          </view>
          <text class="local-trans">{{ w.translation || '（未填释义）' }}</text>
        </view>
        <text class="chevron">›</text>
      </view>
      <text class="block-hint">本地词条点开即看，不依赖网络</text>
    </view>

    <!-- 中文查询的英文候选 -->
    <view v-if="result && result.kind === 'zh'" class="card">
      <view class="row">
        <text class="block-title">「{{ result.query }}」的英文候选</text>
        <text v-if="result.cached" class="cached-tag">本地缓存</text>
      </view>
      <view v-for="(c, i) in result.candidates" :key="c.word" class="cand-item" @click="runSearch(c.word)">
        <text class="cand-idx">{{ i + 1 }}</text>
        <view class="cand-main">
          <view class="cand-line">
            <text class="cand-word">{{ c.word }}</text>
            <text v-if="c.pos" class="pos-tag">{{ c.pos }}</text>
            <text v-if="c.phonetic_us" class="cand-phon">{{ c.phonetic_us }}</text>
          </view>
          <text class="cand-brief">{{ c.brief }}</text>
        </view>
        <view class="mini-play" :class="{ on: speakingKey === `cand:${c.word}` }" @click.stop="speak(`cand:${c.word}`, c.word, 'en')">
          {{ speakingKey === `cand:${c.word}` ? '■' : '▶' }}
        </view>
      </view>
      <text class="block-hint">点候选词查看完整释义与例句</text>
    </view>

    <!-- 降级提示 -->
    <view v-if="fallbackHint" class="card hint-card">
      <text class="hint-text">{{ fallbackHint }}</text>
    </view>

    <!-- 词条详情（云端条目 / 本地词条共用一套渲染） -->
    <view v-if="entry" class="entry">
      <view class="card head-card">
        <view class="head-line">
          <text class="head-word">{{ entry.word }}</text>
          <text v-if="entry.base" class="head-base">原形 {{ entry.base }}</text>
          <text v-if="isLocalEntry" class="cached-tag">本地词库</text>
          <text v-else-if="result && result.kind === 'en' && result.cached" class="cached-tag">本地缓存</text>
        </view>

        <view v-if="entry.phonetic_us || entry.phonetic_uk" class="phon-row">
          <view
            v-if="entry.phonetic_us" class="phon-chip"
            :class="{ on: speakingKey === 'word:US' }"
            @click="speak('word:US', entry.word, 'en', 'US')"
          >
            <text class="phon-label">US</text>
            <text class="phon-text">{{ entry.phonetic_us }}</text>
            <text class="phon-play">{{ speakingKey === 'word:US' ? '■' : '🔊' }}</text>
          </view>
          <view
            v-if="entry.phonetic_uk" class="phon-chip"
            :class="{ on: speakingKey === 'word:UK' }"
            @click="speak('word:UK', entry.word, 'en', 'UK')"
          >
            <text class="phon-label">UK</text>
            <text class="phon-text">{{ entry.phonetic_uk }}</text>
            <text class="phon-play">{{ speakingKey === 'word:UK' ? '■' : '🔊' }}</text>
          </view>
        </view>

        <view class="head-actions">
          <button class="btn btn-sm add-btn" @click="onAddToNotebook">＋ 加入生词本</button>
          <text class="mini-link" @click="onLookupCloud">{{ isLocalEntry ? '查云端词典' : '重新查询' }}</text>
        </view>

        <text v-if="entry.notes" class="notes">{{ entry.notes }}</text>
      </view>

      <view class="card">
        <text class="block-title">释义</text>
        <view v-for="(s, i) in entry.senses" :key="i" class="sense">
          <view class="sense-head">
            <text v-if="s.pos" class="pos-tag">{{ s.pos }}</text>
            <text class="sense-zh">{{ s.def_zh || s.def_en }}</text>
            <text
              v-if="s.def_zh" class="sense-play"
              :class="{ on: speakingKey === `sense:${i}` }"
              @click="speak(`sense:${i}`, s.def_zh, 'zh')"
            >{{ speakingKey === `sense:${i}` ? '■' : '中' }}</text>
          </view>
          <text v-if="s.def_en && s.def_zh" class="sense-en">{{ s.def_en }}</text>

          <view v-for="(ex, j) in s.examples" :key="j" class="ex">
            <view class="ex-main">
              <text class="ex-en">{{ ex.en }}</text>
              <text v-if="ex.zh" class="ex-zh">{{ ex.zh }}</text>
            </view>
            <view
              class="mini-play"
              :class="{ on: speakingKey === `ex:${i}:${j}` }"
              @click="speak(`ex:${i}:${j}`, ex.en, 'en')"
            >{{ speakingKey === `ex:${i}:${j}` ? '■' : '▶' }}</view>
          </view>
        </view>
      </view>

      <view v-if="entry.forms.length" class="card">
        <text class="block-title">词形变化</text>
        <view class="chips">
          <text v-for="f in entry.forms" :key="f" class="chip" @click="runSearch(f)">{{ f }}</text>
        </view>
      </view>

      <view v-if="entry.phrases.length" class="card">
        <text class="block-title">常用搭配</text>
        <view v-for="p in entry.phrases" :key="p.en" class="phrase" @click="runSearch(p.en)">
          <text class="phrase-en">{{ p.en }}</text>
          <text v-if="p.zh" class="phrase-zh">{{ p.zh }}</text>
        </view>
      </view>

      <view v-if="entry.synonyms.length || entry.antonyms.length" class="card">
        <view v-if="entry.synonyms.length" class="rel-block">
          <text class="rel-label">近义词</text>
          <view class="chips">
            <text v-for="s in entry.synonyms" :key="s" class="chip" @click="runSearch(s)">{{ s }}</text>
          </view>
        </view>
        <view v-if="entry.antonyms.length" class="rel-block">
          <text class="rel-label">反义词</text>
          <view class="chips">
            <text v-for="s in entry.antonyms" :key="s" class="chip" @click="runSearch(s)">{{ s }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 错误 -->
    <view v-if="errorMsg && !entry" class="card state-card">
      <view class="state-mark">!</view>
      <text class="state-title">{{ errorMsg }}</text>
      <text class="state-sub">已查过的词仍可离线查看；也可以回词库继续练习</text>
      <button class="btn btn-sm retry-btn" @click="onSearch">重试</button>
    </view>

    <!-- 首次进入的空态 -->
    <view v-if="showIntro" class="card intro-card">
      <view class="intro-mark">Aa</view>
      <text class="intro-title">查一个词试试</text>
      <text class="intro-sub">英文查中文释义，中文查对应英文；词条带英美音标、例句、搭配与近反义词。</text>
      <view class="chips intro-chips">
        <text v-for="w in suggestions" :key="w" class="chip" @click="runSearch(w)">{{ w }}</text>
      </view>
      <text class="intro-note">查过的词会缓存在本机，断网也能复看；「加入生词本」后可直接进入练习。</text>
    </view>

    <view class="footer-note">词典结果由云端生成，仅作学习参考 · 本地缓存不出手机</view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onHide, onLoad, onShow } from '@dcloudio/uni-app'
import { playQueue } from '@/services'
import { useSettingsStore } from '@/store/settings'
import { searchWords } from '@/services/storage'
import {
  detectQueryLang, listDictHistory, normalizeQuery, pushDictHistory,
  clearDictHistory, lookupDictionary, type DictEntry, type DictHistoryItem, type DictLookup,
} from '@/services/dictionary'
import { addEntryToNotebook } from '@/services/dict-notebook'
import type { Word } from '@/services/types'
import { ensurePrivacyNotice } from '@/utils/privacy'

const settings = useSettingsStore()

const keyword = ref('')
const pendingQuery = ref('')
const loading = ref(false)
const result = ref<DictLookup | null>(null)
const localHits = ref<Word[]>([])
const localEntry = ref<DictEntry | null>(null)
const history = ref<DictHistoryItem[]>([])
const errorMsg = ref('')
const fallbackHint = ref('')
const speakingKey = ref('')

let searchSeq = 0

const suggestions = ['benefit', 'abandon', '坚持', 'important', '放弃']

const entry = computed<DictEntry | null>(() => {
  if (result.value?.kind === 'en') return result.value.entry
  return localEntry.value
})
const isLocalEntry = computed(() => !(result.value?.kind === 'en') && !!localEntry.value)
const showIntro = computed(() =>
  !loading.value && !entry.value && !result.value && !errorMsg.value && !localHits.value.length,
)

onLoad((query) => {
  const q = typeof query?.q === 'string' ? decodeURIComponent(query.q) : ''
  if (q) void runSearch(q)
})

onShow(async () => {
  void ensurePrivacyNotice()
  await settings.load()
  await refreshHistory()
})

// 切到别的 tab / 退出页面时立刻停读，避免词典朗读留在后台响
onHide(() => {
  playQueue.stop()
  speakingKey.value = ''
})

async function refreshHistory() {
  try { history.value = await listDictHistory(12) } catch (_) { /* 历史失败不影响查词 */ }
}

/** 本地词条 → 与云端条目同构，渲染层不用写两套 */
function wordToEntry(w: Word): DictEntry {
  return {
    word: w.word,
    base: '',
    phonetic_uk: w.phonetic_uk,
    phonetic_us: w.phonetic_us,
    forms: [],
    senses: [{
      pos: w.pos,
      def_zh: w.translation,
      def_en: '',
      examples: w.example ? [{ en: w.example, zh: '' }] : [],
    }],
    phrases: [],
    synonyms: [],
    antonyms: [],
    notes: '',
  }
}

async function runSearch(raw: string, force = false) {
  const q = normalizeQuery(raw)
  if (!q) {
    uni.showToast({ title: '先输入要查的单词或释义', icon: 'none' })
    return
  }
  const token = ++searchSeq
  const prevResult = result.value
  keyword.value = q
  pendingQuery.value = q
  loading.value = true
  errorMsg.value = ''
  fallbackHint.value = ''
  // 「重新查询」时保留旧条目：刷新失败还能继续看，不让页面变空
  if (!force) result.value = null
  localEntry.value = null
  speakingKey.value = ''
  playQueue.stop()

  const lang = detectQueryLang(q)
  try {
    const hits = await searchWords(q)
    if (token === searchSeq) localHits.value = hits
  } catch (_) {
    if (token === searchSeq) localHits.value = []
  }

  void pushDictHistory(q, lang).then(refreshHistory).catch(() => {})

  try {
    const lookup = await lookupDictionary(q, { force })
    if (token !== searchSeq) return
    result.value = lookup
    // 中文查询没有详情，收起本地详情卡；英文查询由云端条目接管
    localEntry.value = null
  } catch (e) {
    if (token !== searchSeq) return
    // 刷新失败时保留上一次结果，只提示；不要让用户正看着的词条突然消失
    if (force && prevResult) {
      result.value = prevResult
      fallbackHint.value = '刷新失败，仍在显示上一次的查询结果。'
      return
    }
    errorMsg.value = (e as Error).message || '查询失败'
    // 离线兜底：有本地命中就直接展示本地释义，别让用户对着空白页
    const exact = localHits.value.find((w) => w.word.toLowerCase() === q.toLowerCase())
    const pick = exact || (lang === 'en' ? localHits.value[0] : undefined)
    if (pick) {
      localEntry.value = wordToEntry(pick)
      fallbackHint.value = `云端词典暂时不可用，先显示「我的词库」里的本地释义（${pick.word}）。`
    }
  } finally {
    if (token === searchSeq) loading.value = false
  }
}

function onSearch() { void runSearch(keyword.value) }

function onClearKeyword() {
  keyword.value = ''
  result.value = null
  localEntry.value = null
  localHits.value = []
  errorMsg.value = ''
  fallbackHint.value = ''
  speakingKey.value = ''
  playQueue.stop()
}

function openLocal(w: Word) {
  result.value = null
  localEntry.value = wordToEntry(w)
  fallbackHint.value = ''
  errorMsg.value = ''
}

function onLookupCloud() {
  const q = isLocalEntry.value ? (entry.value?.word || keyword.value) : keyword.value
  void runSearch(q, true)
}

async function onAddToNotebook() {
  const e = entry.value
  if (!e) return
  try {
    const r = await addEntryToNotebook(e)
    uni.showToast({
      title: r.added ? '已加入「词典生词」' : '生词本里已经收录这个词',
      icon: r.added ? 'success' : 'none',
    })
  } catch (err) {
    uni.showToast({ title: (err as Error).message || '加入失败', icon: 'none' })
  }
}

function onClearHistory() {
  uni.showModal({
    title: '清空查询历史',
    content: '只清除最近查询列表，已缓存的词典释义仍可离线查看。',
    confirmText: '清空',
    success: async (r) => {
      if (!r.confirm) return
      await clearDictHistory()
      await refreshHistory()
    },
  })
}

/** 点喇叭：正在读的再点一次就停，避免多条朗读叠在一起。 */
function speak(key: string, text: string, lang: 'en' | 'zh', accent?: 'US' | 'UK') {
  const t = String(text || '').trim()
  if (!t) return
  if (speakingKey.value === key) {
    playQueue.stop()
    speakingKey.value = ''
    return
  }
  playQueue.stop()
  speakingKey.value = key
  // 例句 / 候选词跟随设置里的英美发音，单词卡上的 US / UK 芯片显式指定
  const useAccent = lang === 'en' ? (accent || settings.data.accent) : undefined
  void playQueue.playSegments([{ text: t, lang, label: lang === 'en' ? '英文' : '中文' }], {
    speed: settings.data.speed,
    volume: settings.data.volume,
    accent: useAccent,
    onSegEnd: () => { if (speakingKey.value === key) speakingKey.value = '' },
  })
}
</script>

<style scoped>
.dict-page { padding-top: 24rpx; }

.hero {
  position: relative; overflow: hidden;
  background: linear-gradient(140deg, #fb923c 0%, #f97316 55%, #ea580c 100%);
  border-radius: 36rpx; padding: 34rpx 30rpx 28rpx;
  color: #fff; box-shadow: 0 18rpx 44rpx rgba(249, 115, 22, .28);
}
.glow { position: absolute; border-radius: 50%; background: rgba(255, 255, 255, .13); }
.glow-a { width: 300rpx; height: 300rpx; right: -90rpx; top: -130rpx; }
.glow-b { width: 180rpx; height: 180rpx; left: -70rpx; bottom: -100rpx; background: rgba(255, 255, 255, .08); }
.hero-top { position: relative; display: flex; justify-content: space-between; align-items: flex-start; }
.hero-copy { display: flex; flex-direction: column; }
.hero-kicker { font-size: 20rpx; letter-spacing: 3rpx; color: rgba(255, 255, 255, .72); }
.hero-title { font-size: 44rpx; font-weight: 700; margin-top: 8rpx; }
.hero-sub { font-size: 23rpx; color: rgba(255, 255, 255, .8); margin-top: 8rpx; }
.hero-mark {
  width: 84rpx; height: 84rpx; border-radius: 26rpx; flex-shrink: 0;
  background: rgba(255, 255, 255, .18); border: 2rpx solid rgba(255, 255, 255, .28);
  display: flex; align-items: center; justify-content: center;
  font-size: 32rpx; font-weight: 700; font-style: italic;
}

.search-box {
  position: relative; display: flex; align-items: center; gap: 14rpx;
  margin-top: 28rpx; background: #fff; border-radius: 999rpx;
  padding: 8rpx 10rpx 8rpx 24rpx;
}
.search-icon { width: 32rpx; height: 32rpx; position: relative; flex-shrink: 0; }
.search-lens {
  position: absolute; left: 2rpx; top: 2rpx; width: 20rpx; height: 20rpx;
  border: 3rpx solid #9aa3b6; border-radius: 50%;
}
.search-handle {
  position: absolute; right: 2rpx; bottom: 4rpx; width: 12rpx; height: 3rpx;
  border-radius: 2rpx; background: #9aa3b6; transform: rotate(45deg);
}
.search-input { flex: 1; height: 76rpx; font-size: 28rpx; color: var(--elr-text); }
.search-clear {
  width: 48rpx; height: 48rpx; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #a4acbd; font-size: 32rpx; background: #f2f4f9;
}
.search-go {
  flex-shrink: 0; padding: 18rpx 30rpx; border-radius: 999rpx;
  background: var(--elr-primary); color: #fff; font-size: 26rpx; font-weight: 600;
}
.search-go.busy { background: #fdba74; }
.hero-tags { position: relative; display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 20rpx; }
.hero-tag {
  font-size: 20rpx; color: rgba(255, 255, 255, .88);
  background: rgba(255, 255, 255, .16); border-radius: 999rpx; padding: 5rpx 14rpx;
}

.hist-card { padding: 24rpx 26rpx 20rpx; }
.block-title { font-size: 29rpx; font-weight: 600; }
.hist-list { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 16rpx; }
.hist-chip {
  font-size: 24rpx; color: #5b6478; background: #faf5f0;
  border-radius: 999rpx; padding: 8rpx 20rpx; max-width: 420rpx;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hist-chip.active { color: var(--elr-primary-dark); background: #fff1e3; }

.state-card { display: flex; flex-direction: column; align-items: center; padding: 48rpx 34rpx; }
.spinner {
  width: 44rpx; height: 44rpx; border-radius: 50%;
  border: 5rpx solid #ffe0c2; border-top-color: var(--elr-primary-dark);
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg) } }
.state-mark {
  width: 56rpx; height: 56rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #fdeceb; color: var(--elr-err); font-size: 30rpx; font-weight: 700;
}
.state-title { font-size: 29rpx; font-weight: 600; margin-top: 20rpx; text-align: center; }
.state-sub { font-size: 23rpx; color: var(--elr-muted); margin-top: 10rpx; text-align: center; line-height: 1.6; }
.retry-btn { margin-top: 24rpx; }

.local-item {
  display: flex; align-items: center; gap: 16rpx;
  padding: 20rpx 0; border-bottom: 1rpx solid var(--elr-line);
}
.local-item:last-of-type { border-bottom: none; }
.local-main { flex: 1; min-width: 0; }
.local-line { display: flex; align-items: center; flex-wrap: wrap; gap: 12rpx; }
.local-word { font-size: 31rpx; font-weight: 600; }
.local-phon { font-size: 23rpx; color: var(--elr-muted); }
.local-trans { display: block; font-size: 25rpx; color: #5b6478; margin-top: 8rpx; line-height: 1.5; }
.block-hint { display: block; font-size: 21rpx; color: #aab1c2; margin-top: 14rpx; }

.pos-tag {
  font-size: 20rpx; color: var(--elr-primary-dark); background: #fff1e3;
  border-radius: 6rpx; padding: 3rpx 10rpx;
}
.wrong-tag { font-size: 20rpx; color: #d97706; background: #fff4e5; border-radius: 6rpx; padding: 3rpx 10rpx; }
.cached-tag { font-size: 20rpx; color: #0f9d63; background: #e9f9f1; border-radius: 6rpx; padding: 3rpx 10rpx; }

.cand-item { display: flex; align-items: center; gap: 18rpx; padding: 22rpx 0; border-bottom: 1rpx solid var(--elr-line); }
.cand-item:last-of-type { border-bottom: none; }
.cand-idx {
  width: 40rpx; height: 40rpx; border-radius: 50%; flex-shrink: 0;
  background: #fff1e3; color: var(--elr-primary-dark); font-size: 22rpx;
  display: flex; align-items: center; justify-content: center;
}
.cand-main { flex: 1; min-width: 0; }
.cand-line { display: flex; align-items: center; flex-wrap: wrap; gap: 12rpx; }
.cand-word { font-size: 32rpx; font-weight: 600; }
.cand-phon { font-size: 22rpx; color: var(--elr-muted); }
.cand-brief { display: block; font-size: 25rpx; color: #5b6478; margin-top: 6rpx; line-height: 1.5; }
.mini-play {
  width: 60rpx; height: 60rpx; border-radius: 50%; flex-shrink: 0;
  background: #fff1e3; color: var(--elr-primary-dark);
  display: flex; align-items: center; justify-content: center;
  font-size: 22rpx;
}
.mini-play.on { background: var(--elr-primary); color: #fff; }

.head-card { padding-bottom: 26rpx; }
.head-line { display: flex; align-items: center; flex-wrap: wrap; gap: 14rpx; }
.head-word { font-size: 52rpx; font-weight: 700; letter-spacing: .5rpx; }
.head-base { font-size: 24rpx; color: var(--elr-muted); }
.phon-row { display: flex; flex-wrap: wrap; gap: 14rpx; margin-top: 18rpx; }
.phon-chip {
  display: flex; align-items: center; gap: 10rpx;
  background: #fdf7f2; border: 1rpx solid #e8ecf6; border-radius: 999rpx;
  padding: 10rpx 20rpx;
}
.phon-chip.on { background: #fff1e3; border-color: #ffcf9e; }
.phon-label { font-size: 19rpx; font-weight: 600; color: #fff; background: #d99b6c; border-radius: 5rpx; padding: 2rpx 8rpx; }
.phon-text { font-size: 25rpx; color: #47506a; }
.phon-play { font-size: 22rpx; color: var(--elr-primary-dark); }
.head-actions { display: flex; align-items: center; gap: 22rpx; margin-top: 24rpx; }
.add-btn { padding: 12rpx 26rpx; }
.notes {
  display: block; font-size: 24rpx; color: #6a7287; line-height: 1.7;
  background: #fffaf5; border-radius: 14rpx; padding: 16rpx 20rpx; margin-top: 20rpx;
}

.sense { padding: 20rpx 0; border-bottom: 1rpx solid var(--elr-line); }
.sense:last-child { border-bottom: none; padding-bottom: 4rpx; }
.sense-head { display: flex; align-items: flex-start; gap: 12rpx; }
.sense-zh { flex: 1; font-size: 29rpx; font-weight: 600; line-height: 1.55; }
.sense-play {
  width: 46rpx; height: 46rpx; border-radius: 50%; flex-shrink: 0;
  background: #fff1e3; color: var(--elr-primary-dark); font-size: 21rpx;
  display: flex; align-items: center; justify-content: center;
}
.sense-play.on { background: var(--elr-primary); color: #fff; }
.sense-en { display: block; font-size: 24rpx; color: var(--elr-muted); margin-top: 6rpx; line-height: 1.6; }
.ex { display: flex; align-items: flex-start; gap: 14rpx; margin-top: 16rpx; }
.ex-main { flex: 1; min-width: 0; }
.ex-en { display: block; font-size: 26rpx; color: #333b4f; line-height: 1.6; }
.ex-zh { display: block; font-size: 23rpx; color: var(--elr-muted); margin-top: 4rpx; line-height: 1.6; }

.chips { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 16rpx; }
.chip {
  font-size: 24rpx; color: #47506a; background: #faf5f0;
  border-radius: 999rpx; padding: 9rpx 20rpx;
}
.chip:active { background: #f6efe7; }

.phrase { display: flex; flex-direction: column; gap: 4rpx; padding: 14rpx 0; border-bottom: 1rpx solid var(--elr-line); }
.phrase:last-child { border-bottom: none; }
.phrase-en { font-size: 27rpx; font-weight: 500; color: #333b4f; }
.phrase-zh { font-size: 23rpx; color: var(--elr-muted); }

.rel-block + .rel-block { margin-top: 24rpx; }
.rel-label { font-size: 25rpx; color: var(--elr-muted); }

.hint-card { background: #fff8ec; box-shadow: none; border: 1rpx solid #f7e6c8; }
.hint-text { font-size: 24rpx; color: #a26a12; line-height: 1.6; }

.intro-card { display: flex; flex-direction: column; align-items: center; padding: 48rpx 36rpx; }
.intro-mark {
  width: 108rpx; height: 108rpx; border-radius: 32rpx;
  background: linear-gradient(135deg, #fff1e3, #ffe0c2); color: var(--elr-primary-dark);
  font-size: 40rpx; font-weight: 700; font-style: italic;
  display: flex; align-items: center; justify-content: center;
}
.intro-title { font-size: 31rpx; font-weight: 600; margin-top: 22rpx; }
.intro-sub { font-size: 24rpx; color: var(--elr-muted); text-align: center; line-height: 1.7; margin-top: 10rpx; }
.intro-chips { justify-content: center; }
.intro-note { font-size: 21rpx; color: #b3bacb; text-align: center; line-height: 1.7; margin-top: 22rpx; }

.footer-note { text-align: center; font-size: 21rpx; color: #b3bacb; padding: 18rpx 0 8rpx; }
</style>

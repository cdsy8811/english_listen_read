<template>
  <view class="page read-page">
    <!-- 文章列表 -->
    <view class="section-head">
      <text class="section-title">我的跟读</text>
      <view class="section-filter">
        <input
          v-model="keyword"
          class="filter-input"
          type="text"
          confirm-type="search"
          placeholder="筛选标题或句子"
          placeholder-class="filter-ph"
        />
        <text v-if="keyword" class="filter-clear" @click="keyword = ''">×</text>
      </view>
      <view class="section-actions">
        <text v-if="articles.length" class="section-more">{{ countLabel }}</text>
        <text class="section-add" @click="onManual">添加</text>
      </view>
    </view>

    <view v-if="filtered.length" class="article-list">
      <view v-for="(a, i) in filtered" :key="a.id" class="article-card" @click="openArticle(a.id)">
        <view class="article-cover" :style="{ background: cover(i) }">{{ badge(i) }}</view>
        <view class="article-main">
          <text class="article-title">{{ a.title }}</text>
          <text class="article-sub">{{ a.sentences.length }} 句 · {{ wordsOf(a) }} 词 · 已练 {{ a.checked }} 句</text>
          <view class="article-foot">
            <text v-if="a.checked" class="article-score" :class="scoreClass(a.lastScore)">上次 {{ a.lastScore }} 分</text>
            <text v-else class="article-new">还没开始</text>
            <view class="article-actions">
              <text class="mini-link" @click.stop="onRename(a)">重命名</text>
              <text class="mini-link danger" @click.stop="onDelete(a)">删除</text>
            </view>
          </view>
        </view>
        <text class="chevron">›</text>
      </view>
    </view>

    <view v-else-if="articles.length" class="card empty-card">
      <text class="empty-title">没有匹配的文章</text>
      <text class="empty-sub">换个关键字，或清空筛选框看全部 {{ articles.length }} 篇。</text>
    </view>

    <view v-else class="card empty-card">
      <view class="empty-mark">▶</view>
      <text class="empty-title">还没有跟读文章</text>
      <text class="empty-sub">输入一段英文短文就能开始：整段听、点词听，录下自己的朗读并检查。</text>
      <button class="btn empty-btn" @click="onManual">手工添加第一篇</button>
    </view>

    <view class="footer-note">手工添加不需要联网；录音与评分需要联网，已保存的文章、句子与历史分数离线可看</view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import {
  deleteArticle, listArticleSummaries, renameArticle,
  type ReadArticleSummary,
} from '@/services/storage'
import { countWords } from '@/services/passage'
import { errText, logger } from '@/utils/log'
import { ensurePrivacyNotice } from '@/utils/privacy'

const articles = ref<ReadArticleSummary[]>([])
/** 顶部筛选：标题或任一英文句子命中关键字即保留，不区分大小写 */
const keyword = ref('')

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return articles.value
  return articles.value.filter((a) =>
    a.title.toLowerCase().includes(k) || a.sentences.some((s) => s.toLowerCase().includes(k)),
  )
})

const countLabel = computed(() =>
  keyword.value.trim()
    ? `${filtered.value.length} / ${articles.value.length} 篇`
    : `${articles.value.length} 篇`,
)

const COVERS = [
  'linear-gradient(135deg, #fdba74, #f97316)',
  'linear-gradient(135deg, #34d399, #10b981)',
  'linear-gradient(135deg, #fbbf24, #f59e0b)',
  'linear-gradient(135deg, #f472b6, #ec4899)',
  'linear-gradient(135deg, #38bdf8, #0ea5e9)',
  'linear-gradient(135deg, #a78bfa, #8b5cf6)',
]

function cover(i: number) { return COVERS[i % COVERS.length] }
function badge(i: number) { return String(i + 1).padStart(2, '0') }
function wordsOf(a: ReadArticleSummary) { return countWords(a.sentences) }
function scoreClass(score: number) { return score >= 85 ? 'good' : score >= 60 ? 'mid' : 'low' }

async function refresh() {
  try {
    articles.value = await listArticleSummaries()
  } catch (e) {
    logger.error('page.read.list.fail', { msg: errText(e) })
    uni.showToast({ title: '读取跟读文章失败', icon: 'none' })
  }
}

onShow(async () => {
  void ensurePrivacyNotice()
  await refresh()
})

onPullDownRefresh(async () => {
  await refresh()
  uni.stopPullDownRefresh()
})

/* ---------------- 手工添加入口 ---------------- */
function onManual() {
  uni.navigateTo({ url: '/pages/read/compose' })
}

function openArticle(id: string) {
  uni.navigateTo({ url: `/pages/read/study?articleId=${id}` })
}

function onRename(a: ReadArticleSummary) {
  uni.showModal({
    title: '重命名跟读文章', editable: true, placeholderText: a.title,
    success: async (r) => {
      if (!r.confirm || !r.content?.trim()) return
      try {
        await renameArticle(a.id, r.content.trim())
        await refresh()
      } catch (e) {
        uni.showToast({ title: errText(e) || '重命名失败', icon: 'none' })
      }
    },
  })
}

function onDelete(a: ReadArticleSummary) {
  uni.showModal({
    title: '删除跟读文章',
    content: `将删除「${a.title}」及其跟读分数，不可恢复。`,
    success: async (r) => {
      if (!r.confirm) return
      try {
        await deleteArticle(a.id)
        await refresh()
      } catch (e) {
        uni.showToast({ title: errText(e) || '删除失败', icon: 'none' })
      }
    },
  })
}
</script>

<style scoped>
.read-page { padding-top: 24rpx; }

/* 顶部中间的筛选框：标题与「添加」之间，按标题或句子关键字过滤 */
.section-filter {
  flex: 1; min-width: 0; display: flex; align-items: center;
  margin: 0 18rpx; height: 62rpx; padding: 0 6rpx 0 22rpx;
  background: #f8f1e9; border: 1rpx solid #f3e7da; border-radius: 999rpx;
}
.filter-input { flex: 1; min-width: 0; height: 62rpx; font-size: 23rpx; color: var(--elr-text); }
.filter-ph { color: #b3bacb; font-size: 22rpx; }
.filter-clear {
  width: 44rpx; flex-shrink: 0; text-align: center;
  font-size: 30rpx; color: #aab1c2; line-height: 1;
}
.filter-clear:active { opacity: .6; }

/* 右上角「添加」：与标题同一行，替代原先的顶部大卡入口 */
.section-actions { display: flex; align-items: center; gap: 18rpx; flex-shrink: 0; }
.section-add {
  font-size: 24rpx; color: var(--elr-primary-dark); background: #fff1e3;
  border-radius: 999rpx; padding: 8rpx 26rpx;
}
.section-add:active { opacity: .7; }

.article-list { display: flex; flex-direction: column; gap: 18rpx; }
.article-card {
  display: flex; align-items: center; gap: 22rpx;
  background: #fff; border-radius: 28rpx; padding: 22rpx 26rpx;
  box-shadow: 0 8rpx 26rpx rgba(27, 33, 48, .05);
}
.article-card:active { background: #fffdfb; }
.article-cover {
  width: 94rpx; height: 94rpx; border-radius: 26rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 32rpx; font-weight: 700; letter-spacing: 1rpx;
}
.article-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.article-title { font-size: 31rpx; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.article-sub { font-size: 22rpx; color: var(--elr-muted); margin-top: 8rpx; }
.article-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 10rpx; }
.article-score { font-size: 22rpx; border-radius: 999rpx; padding: 3rpx 14rpx; }
.article-score.good { color: #0f9d63; background: #e9f9f1; }
.article-score.mid { color: #b45309; background: #fff4e5; }
.article-score.low { color: #dc2626; background: #fdeceb; }
.article-new { font-size: 22rpx; color: #aab1c2; }
.article-actions { display: flex; gap: 24rpx; }
.mini-link { font-size: 22rpx; color: var(--elr-primary-dark); }
.mini-link.danger { color: var(--elr-err); }

.empty-card { display: flex; flex-direction: column; align-items: center; padding: 52rpx 40rpx; }
.empty-mark {
  width: 112rpx; height: 112rpx; border-radius: 34rpx;
  background: linear-gradient(135deg, #fff1e3, #ffe0c2); color: var(--elr-primary-dark);
  font-size: 44rpx; font-weight: 700; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.empty-title { font-size: 32rpx; font-weight: 600; margin: 22rpx 0 10rpx; }
.empty-sub { font-size: 24rpx; color: var(--elr-muted); text-align: center; line-height: 1.7; }
.empty-btn { width: 100%; margin-top: 22rpx; }
.footer-note { text-align: center; font-size: 21rpx; color: #b3bacb; line-height: 1.7; padding: 24rpx 20rpx 10rpx; }
</style>

<template>
  <view class="page records-page">
    <view class="rec-hero">
      <view class="glow" />
      <text class="hero-label">STUDY LOG</text>
      <text class="hero-title">学习记录</text>
      <text class="hero-sub">每次练习 / 跟读的时长与作答概况</text>
      <view class="hero-stats">
        <view class="stat">
          <text class="num">{{ todayText }}</text>
          <text class="label">今日</text>
        </view>
        <view class="line" />
        <view class="stat">
          <text class="num">{{ weekText }}</text>
          <text class="label">近 7 天</text>
        </view>
        <view class="line" />
        <view class="stat">
          <text class="num">{{ sessions.length }}</text>
          <text class="label">记录次数</text>
        </view>
      </view>
    </view>

    <view class="rec-head">
      <text class="rec-title">最近记录</text>
      <text v-if="sessions.length" class="rec-clear" @click="onClear">清空记录</text>
    </view>

    <view v-if="groups.length" class="group-list">
      <view v-for="g in groups" :key="g.day" class="group">
        <text class="group-day">{{ g.label }}</text>
        <view class="card group-card">
          <view v-for="s in g.items" :key="s.id" class="sess">
            <text class="sess-time">{{ fmtTime(s.started_at) }}</text>
            <view class="sess-main">
              <view class="sess-line">
                <text class="sess-title">{{ s.title || '未命名' }}</text>
                <text class="sess-tag" :class="tagClass(s)">{{ labelOf(s) }}</text>
              </view>
              <text class="sess-sub">{{ subOf(s) }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-else class="card empty-card">
      <view class="empty-mark">⏱</view>
      <text class="empty-title">还没有学习记录</text>
      <text class="sub">去练几组单词或读一段短文，这里会记下每次的时长和成绩。</text>
    </view>

    <text class="foot">只统计在练习页 / 跟读页停留的时间；不足 10 秒且没有作答的误触不记录。明细成绩仍可在错词本查看。</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { clearStudySessions, listStudySessions } from '@/services/storage'
import type { StudySession } from '@/services/types'
import { errText, logger } from '@/utils/log'

const sessions = ref<StudySession[]>([])

onShow(() => { void load() })

async function load() {
  try {
    sessions.value = await listStudySessions(200)
  } catch (e) {
    logger.error('page.records.load.fail', { msg: errText(e) })
    uni.showToast({ title: '读取学习记录失败', icon: 'none' })
  }
}

const todayText = computed(() => fmtShort(totalSecondsSince(startOfToday())))
const weekText = computed(() => fmtShort(totalSecondsSince(Date.now() - 7 * 86400000)))

function totalSecondsSince(from: number): number {
  return sessions.value
    .filter((s) => s.started_at >= from)
    .reduce((sum, s) => sum + s.duration_sec, 0)
}

/** 汇总数字要短：10 秒 / 3 分 / 1.2 时 */
function fmtShort(sec: number): string {
  if (!sec) return '0'
  if (sec < 60) return `${sec} 秒`
  if (sec < 3600) return `${Math.round(sec / 60)} 分`
  return `${(sec / 3600).toFixed(1)} 时`
}

const groups = computed(() => {
  const map = new Map<string, StudySession[]>()
  for (const s of sessions.value) {
    const key = dayKey(s.started_at)
    const list = map.get(key) || []
    list.push(s)
    map.set(key, list)
  }
  return [...map.entries()].map(([day, items]) => ({ day, label: dayLabel(day), items }))
})

function dayKey(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayLabel(day: string): string {
  const today = dayKey(Date.now())
  const yesterday = dayKey(Date.now() - 86400000)
  if (day === today) return '今天'
  if (day === yesterday) return '昨天'
  const [y, m, d] = day.split('-')
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(Number(y), Number(m) - 1, Number(d)).getDay()]
  return `${m}-${d} ${week}`
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec} 秒`
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return `${h} 小时${m ? ` ${m} 分` : ''}`
}

function labelOf(s: StudySession): string {
  if (s.kind === 'read') return '跟读'
  if (s.mode === 'dictation') return '默写'
  return s.mode === '2.1' ? '共读' : s.mode === '2.2' ? '中英' : '英中'
}

/** 一条记录的副标题：没作答就只显示时长，别出现「平均 0 分」的噪音 */
function subOf(s: StudySession): string {
  const head = s.kind === 'read'
    ? `${s.answered} 句检查`
    : `${s.answered} 次作答 / ${s.total} 词`
  const score = s.answered
    ? ` · 平均 ${s.avg_score} 分 · 达标 ${s.passed} 次`
    : ''
  return `${head}${score} · 用时 ${fmtDuration(s.duration_sec)}`
}

function tagClass(s: StudySession): string {
  if (s.kind === 'read') return 'tag-read'
  if (s.mode === 'dictation') return 'tag-dict'
  return s.mode === '2.1' ? 'tag-read' : 'tag-practice'
}

function onClear() {
  uni.showModal({
    title: '清空学习记录',
    content: '只删除这些时长与概况记录，词库、成绩明细、跟读文章都不受影响。',
    confirmText: '清空',
    confirmColor: '#dc2626',
    success: async (r) => {
      if (!r.confirm) return
      try {
        await clearStudySessions()
        await load()
        uni.showToast({ title: '已清空', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: errText(e) || '清空失败', icon: 'none' })
      }
    },
  })
}
</script>

<style scoped>
.records-page { padding-top: 24rpx; }

.rec-hero {
  position: relative; overflow: hidden;
  background: linear-gradient(140deg, #fb923c 0%, #f97316 55%, #ea580c 100%);
  border-radius: 34rpx; padding: 34rpx 30rpx 26rpx; color: #fff;
  box-shadow: 0 18rpx 44rpx rgba(249, 115, 22, .28);
}
.glow { position: absolute; width: 260rpx; height: 260rpx; border-radius: 50%; right: -80rpx; top: -110rpx; background: rgba(255, 255, 255, .14); }
.hero-label { position: relative; font-size: 20rpx; letter-spacing: 3rpx; color: rgba(255, 255, 255, .72); }
.hero-title { position: relative; display: block; font-size: 42rpx; font-weight: 700; margin-top: 8rpx; }
.hero-sub { position: relative; display: block; font-size: 22rpx; color: rgba(255, 255, 255, .8); margin-top: 8rpx; }
.hero-stats { position: relative; display: flex; align-items: center; margin-top: 26rpx; }
.stat { flex: 1; display: flex; flex-direction: column; align-items: center; }
.num { font-size: 38rpx; font-weight: 700; line-height: 1.2; }
.label { font-size: 21rpx; color: rgba(255, 255, 255, .74); margin-top: 4rpx; }
.line { width: 1rpx; height: 44rpx; background: rgba(255, 255, 255, .25); }

.rec-head { display: flex; align-items: center; justify-content: space-between; margin: 26rpx 8rpx 14rpx; }
.rec-title { font-size: 28rpx; font-weight: 600; }
.rec-clear { font-size: 22rpx; color: var(--elr-muted); }

.group { margin-bottom: 18rpx; }
.group-day { display: block; font-size: 22rpx; color: var(--elr-muted); margin: 0 8rpx 10rpx; }
.group-card { padding: 4rpx 26rpx; margin-bottom: 0; }
.sess { display: flex; gap: 20rpx; padding: 20rpx 0; border-bottom: 1rpx solid var(--elr-line); }
.sess:last-child { border-bottom: none; }
.sess-time { flex-shrink: 0; width: 88rpx; font-size: 23rpx; color: #8a93a8; line-height: 1.4; }
.sess-main { flex: 1; min-width: 0; }
.sess-line { display: flex; align-items: center; gap: 12rpx; }
.sess-title { font-size: 27rpx; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sess-tag { flex-shrink: 0; font-size: 20rpx; border-radius: 8rpx; padding: 2rpx 10rpx; }
.tag-dict { color: #b45309; background: #fff4e5; }
.tag-practice { color: var(--elr-primary-dark); background: #fff1e3; }
.tag-read { color: #7c5cf0; background: #f2eeff; }
.sess-sub { display: block; font-size: 21rpx; color: var(--elr-muted); margin-top: 8rpx; line-height: 1.5; }

.empty-card { display: flex; flex-direction: column; align-items: center; padding: 56rpx 40rpx; }
.empty-mark {
  width: 110rpx; height: 110rpx; border-radius: 50%;
  background: #fff1e3; color: var(--elr-primary-dark);
  font-size: 44rpx; display: flex; align-items: center; justify-content: center;
}
.empty-title { font-size: 30rpx; font-weight: 600; margin: 22rpx 0 8rpx; }
.foot { display: block; text-align: center; font-size: 20rpx; color: #b3bacb; line-height: 1.7; padding: 26rpx 20rpx 10rpx; }
</style>

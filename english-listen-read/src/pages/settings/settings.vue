<template>
  <view class="page">
    <!-- 全局 -->
    <view class="card">
      <text class="title">全局朗读</text>
      <view class="divider" />

      <view class="set-row">
        <view>
          <text class="set-label">朗读速度</text>
          <text class="sub">{{ settings.data.speed.toFixed(1) }}×</text>
        </view>
        <slider :value="settings.data.speed" :min="0.5" :max="2" :step="0.1"
          show-value :activeColor="'#2f6fed'" style="width: 360rpx" @change="onSpeed" />
      </view>
      <view class="set-row">
        <text class="set-label">英美发音</text>
        <picker :range="['US 美音', 'UK 英音']" @change="onAccent">
          <text class="set-value">{{ settings.data.accent === 'US' ? 'US 美音' : 'UK 英音' }} ›</text>
        </picker>
      </view>
      <view class="set-row">
        <view>
          <text class="set-label">音量</text>
          <text class="sub">{{ settings.data.volume }}%</text>
        </view>
        <slider :value="settings.data.volume" :min="0" :max="100" :step="5"
          :activeColor="'#2f6fed'" style="width: 360rpx" @change="onVolume" />
      </view>
      <view class="set-row">
        <text class="set-label">进入练习自动播放</text>
        <switch :checked="settings.data.autoPlay" color="#2f6fed" @change="onAutoPlay" />
      </view>
    </view>

    <!-- 2.1 中英共读 -->
    <view class="card">
      <text class="title">2.1 中英共读</text>
      <view class="divider" />
      <view class="set-row">
        <text class="set-label">播放顺序</text>
        <picker :range="playOrderLabels" @change="onPlayOrder">
          <text class="set-value">{{ playOrderLabels[playOrderIndex] }} ›</text>
        </picker>
      </view>
      <view class="set-row">
        <text class="set-label">每条重复次数</text>
        <picker :range="['1 次', '2 次', '3 次']" @change="onRepeat">
          <text class="set-value">{{ settings.data.repeatTimes }} 次 ›</text>
        </picker>
      </view>
      <view class="set-row">
        <view>
          <text class="set-label">条目间隔</text>
          <text class="sub">{{ settings.data.itemGapSec.toFixed(1) }} 秒</text>
        </view>
        <slider :value="settings.data.itemGapSec" :min="0" :max="10" :step="0.5"
          :activeColor="'#2f6fed'" style="width: 360rpx" @change="onGap" />
      </view>
    </view>

    <!-- 2.2 / 2.3 作答与推进 -->
    <view class="card">
      <text class="title">2.2 / 2.3 作答与推进</text>
      <view class="divider" />
      <view class="set-row">
        <text class="set-label">作答方式</text>
        <picker :range="['录音', '输入框']" @change="onAnswerType">
          <text class="set-value">{{ settings.data.answerType === 'record' ? '录音' : '输入框' }} ›</text>
        </picker>
      </view>
      <view class="set-row">
        <text class="set-label">推进模式</text>
        <picker :range="['提交后进入下一条', '间隔一定时间后进入下一条']" @change="onAdvance">
          <text class="set-value">{{ settings.data.advanceMode === 'submit' ? '提交后' : '定时' }} ›</text>
        </picker>
      </view>
      <view class="set-row" v-if="settings.data.advanceMode === 'timer'">
        <view>
          <text class="set-label">等待秒数</text>
          <text class="sub">{{ settings.data.waitSec }} 秒</text>
        </view>
        <slider :value="settings.data.waitSec" :min="1" :max="15" :step="1"
          :activeColor="'#2f6fed'" style="width: 360rpx" @change="onWait" />
      </view>
      <view class="set-row">
        <text class="set-label">评分严格度</text>
        <picker :range="['宽松', '标准', '严格']" @change="onStrictness">
          <text class="set-value">{{ strictLabel }} ›</text>
        </picker>
      </view>
      <view class="set-row">
        <view>
          <text class="set-label">错词本收录线</text>
          <text class="sub">低于 {{ settings.data.wrongThreshold }} 分自动收录</text>
        </view>
        <slider :value="settings.data.wrongThreshold" :min="0" :max="100" :step="10"
          :activeColor="'#2f6fed'" style="width: 360rpx" @change="onThreshold" />
      </view>
    </view>

    <!-- 运行状态 -->
    <view class="card">
      <text class="title">运行状态</text>
      <view class="divider" />
      <view class="set-row">
        <text class="set-label">凭据注入</text>
        <text class="set-value" :style="{ color: cloudReady ? '#18a058' : '#e8912d' }">
          {{ cloudReady ? (cfg.ready ? '已就绪（直连讯飞）' : '浏览器预览（走本机代理）') : '未就绪（本地功能可用）' }}
        </text>
      </view>
      <text class="sub">方案 C：App 端自签名直连，无需电脑 / 服务器。密钥只在本机 .env.local 与 APK 中。</text>
      <view class="divider" />
      <button class="btn btn-plain" @click="onReset">恢复默认设置</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useSettingsStore } from '@/store/settings'
import { configSummary, cloudAvailable } from '@/api/runtime-config'
import type { Accent, AdvanceMode, AnswerType, PlayOrder, Strictness } from '@/services/types'

const settings = useSettingsStore()
void settings.load()
const cfg = ref(configSummary())
const cloudReady = cloudAvailable()

onShow(() => { void settings.load() })

const playOrderLabels = ['英 → 中', '中 → 英', '仅英文']
const playOrderIndex = computed(() => ['en-zh', 'zh-en', 'en-only'].indexOf(settings.data.playOrder))
const strictLabel = computed(() => ({ loose: '宽松', normal: '标准', strict: '严格' })[settings.data.strictness])

const onSpeed = (e: { detail: { value: number } }) => void settings.set('speed', Number(e.detail.value.toFixed(1)))
const onVolume = (e: { detail: { value: number } }) => void settings.set('volume', e.detail.value)
const onGap = (e: { detail: { value: number } }) => void settings.set('itemGapSec', Number(e.detail.value.toFixed(1)))
const onWait = (e: { detail: { value: number } }) => void settings.set('waitSec', e.detail.value)
const onThreshold = (e: { detail: { value: number } }) => void settings.set('wrongThreshold', e.detail.value)
// switch 的 change 事件在 vue-tsc 里被解析为 DOM 原生事件，用 any 承接 uni-app 的 detail
const onAutoPlay = (e: any) => void settings.set('autoPlay', e.detail.value as boolean)
const onAccent = (e: { detail: { value: number } }) => void settings.set('accent', (['US', 'UK'] as Accent[])[e.detail.value])
const onAnswerType = (e: { detail: { value: number } }) => void settings.set('answerType', (['record', 'input'] as AnswerType[])[e.detail.value])
const onAdvance = (e: { detail: { value: number } }) => void settings.set('advanceMode', (['submit', 'timer'] as AdvanceMode[])[e.detail.value])
const onPlayOrder = (e: { detail: { value: number } }) => void settings.set('playOrder', (['en-zh', 'zh-en', 'en-only'] as PlayOrder[])[e.detail.value])
const onRepeat = (e: { detail: { value: number } }) => void settings.set('repeatTimes', e.detail.value + 1)
const onStrictness = (e: { detail: { value: number } }) => void settings.set('strictness', (['loose', 'normal', 'strict'] as Strictness[])[e.detail.value])

function onReset() {
  uni.showModal({
    title: '恢复默认设置', content: '只重置设置项，不会删除词库与练习记录。',
    success: (r) => { if (r.confirm) void settings.reset() },
  })
}
</script>

<style scoped>
.set-row { display: flex; align-items: center; justify-content: space-between; min-height: 88rpx; gap: 20rpx; }
.set-label { font-size: 28rpx; }
.set-value { font-size: 28rpx; color: var(--elr-primary); }
</style>

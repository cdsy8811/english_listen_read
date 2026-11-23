<template>
  <view class="page mine-page">
    <view class="mine-hero">
      <view class="glow" />
      <view class="mine-avatar">Aa</view>
      <view class="mine-copy">
        <text class="mine-title">我的</text>
        <text class="mine-sub">离线可用 · 数据只保存在本机</text>
      </view>
    </view>

    <view class="card menu-card">
      <view class="menu-item" @click="goRecords">
        <view class="menu-icon icon-brand">习</view>
        <view class="menu-main">
          <text class="menu-title">学习记录</text>
          <text class="menu-sub">每次练习 / 跟读的时长与成绩概况</text>
        </view>
        <text class="menu-arrow">›</text>
      </view>

      <view class="menu-item" @click="goSettings">
        <view class="menu-icon icon-green">设</view>
        <view class="menu-main">
          <text class="menu-title">设置</text>
          <text class="menu-sub">语速、发音、推进与朗读缓存</text>
        </view>
        <text class="menu-arrow">›</text>
      </view>

      <view class="menu-item" @click="goAbout">
        <view class="menu-icon icon-violet">i</view>
        <view class="menu-main">
          <text class="menu-title">关于</text>
          <text class="menu-sub">版本与使用说明</text>
        </view>
        <text class="menu-arrow">›</text>
      </view>

      <view class="menu-item" @click="onQuit">
        <view class="menu-icon icon-rose">退</view>
        <view class="menu-main">
          <text class="menu-title">退出</text>
          <text class="menu-sub">关闭应用</text>
        </view>
        <text class="menu-arrow">›</text>
      </view>
    </view>

    <view class="footer-note">橙子英语 · 自用学习版 · v{{ version }}</view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const version = ref('1.0.0')
try {
  const info = uni.getSystemInfoSync()
  if (info.appVersion) version.value = info.appVersion
} catch (_) { /* 预览环境忽略 */ }

function goRecords() { uni.navigateTo({ url: '/pages/records/records' }) }
function goSettings() { uni.navigateTo({ url: '/pages/settings/settings' }) }
function goAbout() { uni.navigateTo({ url: '/pages/about/about' }) }

function onQuit() {
  uni.showModal({
    title: '退出应用',
    content: '确定要关闭「橙子英语」吗？本机数据不会丢失。',
    confirmText: '退出',
    confirmColor: '#dc2626',
    success: (r) => {
      if (!r.confirm) return
      // #ifdef APP-PLUS
      plus.runtime.quit()
      // #endif
      // #ifndef APP-PLUS
      uni.showToast({ title: '浏览器预览无法退出，请直接关闭标签页', icon: 'none' })
      // #endif
    },
  })
}
</script>

<style scoped>
.mine-page { padding-top: 24rpx; }

.mine-hero {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 24rpx;
  background: linear-gradient(140deg, #fb923c 0%, #f97316 55%, #ea580c 100%);
  border-radius: 34rpx; padding: 38rpx 32rpx;
  color: #fff; box-shadow: 0 18rpx 44rpx rgba(249, 115, 22, .28);
}
.glow { position: absolute; width: 260rpx; height: 260rpx; border-radius: 50%; right: -80rpx; top: -110rpx; background: rgba(255, 255, 255, .14); }
.mine-avatar {
  position: relative; flex-shrink: 0;
  width: 104rpx; height: 104rpx; border-radius: 32rpx;
  background: rgba(255, 255, 255, .2); border: 2rpx solid rgba(255, 255, 255, .3);
  display: flex; align-items: center; justify-content: center;
  font-size: 38rpx; font-weight: 700; font-style: italic;
}
.mine-copy { position: relative; display: flex; flex-direction: column; min-width: 0; }
.mine-title { font-size: 42rpx; font-weight: 700; }
.mine-sub { font-size: 22rpx; color: rgba(255, 255, 255, .8); margin-top: 8rpx; }

.menu-card { margin-top: 24rpx; padding: 6rpx 28rpx; }
.menu-item {
  display: flex; align-items: center; gap: 20rpx;
  padding: 26rpx 0; border-bottom: 1rpx solid var(--elr-line);
}
.menu-item:last-child { border-bottom: none; }
.menu-item:active { opacity: .75; }
.menu-icon {
  width: 68rpx; height: 68rpx; border-radius: 22rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 27rpx; font-weight: 600; color: #fff;
}
.icon-brand { background: linear-gradient(135deg, #fdba74, #f97316); }
.icon-green { background: linear-gradient(135deg, #34d399, #10b981); }
.icon-violet { background: linear-gradient(135deg, #a78bfa, #7c5cf0); }
.icon-rose { background: linear-gradient(135deg, #fb7185, #f43f5e); }
.menu-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.menu-title { font-size: 30rpx; font-weight: 600; }
.menu-sub { font-size: 21rpx; color: var(--elr-muted); margin-top: 6rpx; }
.menu-arrow { color: #c3c9d8; font-size: 36rpx; }

.footer-note { text-align: center; font-size: 21rpx; color: #b3bacb; padding: 34rpx 0 12rpx; }
</style>

<template>
  <view class="page about-page">
    <view class="about-hero">
      <image class="about-mark" src="/static/brand/mark.png" mode="aspectFit" />
      <text class="about-name">橙子英语</text>
      <text class="about-ver">v{{ version }} · 自用学习版</text>
    </view>

    <view class="card about-card">
      <text class="about-title">能做什么</text>
      <text class="about-line">· 拍照把单词表变成词库，也能手工添加 / 导入备份。</text>
      <text class="about-line">· 三种练习：中英共读、看中说英、看英说中；另有「默写」用自定义键盘。</text>
      <text class="about-line">· 电子词典：中英互查、音标、例句、逐条朗读、加入生词本。</text>
      <text class="about-line">· 短文跟读：粘贴英文短文，自动生成逐句中文，点词听音、逐句录音检查。</text>
      <text class="about-line">· 错词本记录每次成绩详情，可只针对错词做默写 / 语音重练。</text>
      <text class="about-line">· 学习记录：每次练习 / 跟读的时长、作答次数与平均分，按天汇总。</text>
    </view>

    <view class="card about-card">
      <text class="about-title">数据与隐私</text>
      <text class="about-line">· 词库、练习记录、跟读文章与译文只保存在本机 SQLite。</text>
      <text class="about-line">· 断网时首页、词库、错词本、已缓存音频与已保存文章仍可用。</text>
      <text class="about-line">· 语音识别、朗读合成、翻译与词典需要联网，调用讯飞接口。</text>
      <text class="about-line">· 本 APK 为本人自用版本，密钥随包，请勿外传或分发。</text>
    </view>

    <view class="card about-card">
      <text class="about-title">评分口径</text>
      <text class="about-line">· 只评「内容正确度」（文本对错），不含发音分、准确度、流利度。</text>
      <text class="about-line">· 同音词、拆写空格等常见听写误差会容错，近音不同词仍算错。</text>
    </view>

    <view class="foot">离线可用 · 数据只保存在本机</view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const version = ref('1.0.0')
try {
  const info = uni.getSystemInfoSync()
  if (info.appVersion) version.value = info.appVersion
} catch (_) { /* 预览环境忽略 */ }
</script>

<style scoped>
.about-page { padding-top: 24rpx; }
.about-hero {
  display: flex; flex-direction: column; align-items: center;
  background: linear-gradient(140deg, #fb923c 0%, #f97316 60%, #ea580c 100%);
  border-radius: 34rpx; padding: 48rpx 30rpx 40rpx; color: #fff;
  box-shadow: 0 18rpx 44rpx rgba(249, 115, 22, .28);
}
.about-mark {
  width: 132rpx; height: 132rpx;
}
.about-name { font-size: 38rpx; font-weight: 700; margin-top: 20rpx; }
.about-ver { font-size: 22rpx; color: rgba(255, 255, 255, .78); margin-top: 8rpx; }

.about-card { margin-top: 22rpx; padding: 28rpx 30rpx; }
.about-title { display: block; font-size: 28rpx; font-weight: 600; margin-bottom: 12rpx; }
.about-line { display: block; font-size: 23rpx; color: #4a5164; line-height: 1.8; }
.foot { text-align: center; font-size: 21rpx; color: #b3bacb; padding: 30rpx 0 12rpx; }
</style>

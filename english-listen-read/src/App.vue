<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { initDatabase } from '@/utils/db'
import { useSettingsStore } from '@/store/settings'
import { checkClockOffset } from '@/utils/clock'
import { credentialsReady } from '@/api/runtime-config'

onLaunch(async () => {
  // 本地库先行：断网时首页、词条、错词本、设置必须可用
  try {
    await initDatabase()
    await useSettingsStore().load()
  } catch (e) {
    console.warn('[boot] 本地库初始化失败（仅记录类型，不输出内容）', (e as Error).name)
  }
  if (!credentialsReady()) {
    console.warn('[boot] 未注入凭据，云能力不可用；本地功能仍可用')
  }
  // 服务端签名容差 ±300s，偏差 >120s 提示校准（不阻塞启动）
  void checkClockOffset()
})

onShow(() => {
  // 从后台切回时，若时间被手动调整过，重新检测一次
  void checkClockOffset()
})
</script>

<style>
page {
  --elr-primary: #2f6fed;
  --elr-bg: #f6f7fb;
  --elr-card: #ffffff;
  --elr-text: #1f2430;
  --elr-muted: #7a8296;
  --elr-ok: #18a058;
  --elr-warn: #e8912d;
  --elr-err: #e0483c;
  --elr-line: #e6e9f2;
  background: var(--elr-bg);
  color: var(--elr-text);
  font-size: 30rpx;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
view, text, input, textarea, button { box-sizing: border-box; }
.page { min-height: 100vh; padding: 24rpx; }
.card { background: var(--elr-card); border-radius: 20rpx; padding: 28rpx; margin-bottom: 24rpx; box-shadow: 0 4rpx 20rpx rgba(31,36,48,.05); }
.row { display: flex; align-items: center; justify-content: space-between; }
.row-start { display: flex; align-items: center; gap: 16rpx; }
.title { font-size: 34rpx; font-weight: 600; }
.sub { font-size: 26rpx; color: var(--elr-muted); }
.muted { color: var(--elr-muted); }
.btn { background: var(--elr-primary); color: #fff; border-radius: 14rpx; padding: 20rpx 28rpx; font-size: 28rpx; line-height: 1.3; text-align: center; border: none; }
.btn-ghost { background: #eef2ff; color: var(--elr-primary); }
.btn-plain { background: #fff; color: var(--elr-text); border: 1rpx solid var(--elr-line); }
.btn-danger { background: #fdeceb; color: var(--elr-err); }
.btn-sm { padding: 12rpx 20rpx; font-size: 24rpx; }
.btn:active { opacity: .82; }
.tag { font-size: 22rpx; color: var(--elr-primary); background: #eef2ff; border-radius: 8rpx; padding: 4rpx 12rpx; }
.divider { height: 1rpx; background: var(--elr-line); margin: 20rpx 0; }
/* 输入框：uni-app H5 把 <input> 包成 uni-input 自定义元素，默认高度为 auto 且是 flex 容器，
   只给 padding 会让内部真实 input 被压到 ~2px（文字只露出一点）。这里显式给宿主高度并撑开内部节点。 */
.input {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  height: 88rpx;
  min-height: 88rpx;
  padding: 16rpx 20rpx;
  font-size: 28rpx;
  line-height: 1.5;
  color: var(--elr-text);
  background: #f4f6fb;
  border: 1rpx solid var(--elr-line);
  border-radius: 12rpx;
}
uni-input.input > .uni-input-wrapper,
uni-input.input > .uni-input-wrapper > .uni-input-input,
uni-input.input input {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 48rpx;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
}
/* 多行框：内联 style 的 height 仍可覆盖；display 改回 block，避免内部 textarea 被 flex 压缩 */
textarea.input,
uni-textarea.input {
  display: block;
  align-items: stretch;
  height: 320rpx;
  line-height: 1.6;
  padding: 18rpx 20rpx;
}
uni-textarea.input textarea,
uni-textarea.input .uni-textarea-textarea {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 120rpx;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
}
/* uni.showModal({ editable: true }) 的可编辑文本框默认只有 48px，长名称会被裁掉 */
body .uni-modal__textarea {
  box-sizing: border-box !important;
  display: block !important;
  width: 100% !important;
  height: 160rpx !important;
  min-height: 160rpx !important;
  padding: 16rpx 20rpx !important;
  font-size: 28rpx !important;
  line-height: 1.5 !important;
  color: var(--elr-text) !important;
  background: #f4f6fb !important;
  border: 1rpx solid var(--elr-line) !important;
  border-radius: 12rpx !important;
}
.empty { text-align: center; color: var(--elr-muted); padding: 120rpx 40rpx; font-size: 28rpx; }
</style>

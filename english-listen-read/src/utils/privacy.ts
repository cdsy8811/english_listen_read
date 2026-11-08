/** 首次启动的隐私告知（自用 App 也要说清数据去向）；只展示一次，不阻塞本地功能。 */
const KEY = 'elr-privacy-notice-v1'

const NOTICE =
  '本应用是你自用的英语听读工具，完全离线可用的部分包括词库、设置、错词本与练习记录（只存在本机）。\n' +
  '仅当你主动拍照或录音时，图片 / 音频会直连讯飞开放平台用于文字识别、语音转写与语音合成；' +
  'App 不经过任何自建服务器，不接入第三方统计或崩溃收集，不上传词库。\n' +
  '断网时可改用文本录入与输入框作答。凭据仅用于直连讯飞，不用于其它用途。'

export function ensurePrivacyNotice(): Promise<void> {
  let seen = false
  try { seen = !!uni.getStorageSync(KEY) } catch (_) { /* 存储不可用时仍展示一次 */ }
  if (seen) return Promise.resolve()
  return new Promise((resolve) => {
    uni.showModal({
      title: '隐私说明',
      content: NOTICE,
      confirmText: '我知道了',
      showCancel: false,
      success: () => {
        try { uni.setStorageSync(KEY, 1) } catch (_) { /* ignore */ }
        resolve()
      },
      fail: () => resolve(),
    })
  })
}

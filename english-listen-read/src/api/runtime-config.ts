/**
 * 运行时配置入口：上层只通过这里拿配置，永远接触不到密钥明文。
 * 真实值来自构建期生成的 src/api/generated/credentials.ts（本地、gitignore、分片混淆）。
 */
import { CREDENTIALS_READY, MISSING_KEYS, PUBLIC_CONFIG, reveal } from './generated/credentials.ts'

export type PublicKey = keyof typeof PUBLIC_CONFIG

export function credentialsReady(): boolean {
  return CREDENTIALS_READY
}

export function missingKeys(): string[] {
  return MISSING_KEYS
}

export function publicConfig(key: string): string {
  return PUBLIC_CONFIG[key] || ''
}

/** 敏感值按需取、用完即弃；不要长期保存在全局变量或打印。 */
export function secret(key: string): string {
  return reveal(key)
}

export const ENDPOINTS = {
  maasBase: publicConfig('XFYUN_MAAS_BASE_URL'),
  maasModel: publicConfig('XFYUN_MAAS_MODEL') || 'spark-x2.6',
  ocrUrl: publicConfig('XFYUN_OCR_URL'),
  ocrSignHost: publicConfig('XFYUN_OCR_SIGN_HOST'),
  iatWss: publicConfig('XFYUN_IAT_WSS'),
  ttsWss: publicConfig('XFYUN_TTS_WSS'),
  vcnZh: publicConfig('XFYUN_TTS_VCN_ZH'),
  vcnEn: publicConfig('XFYUN_TTS_VCN_EN'),
}

export function appId(): string {
  return secret('XFYUN_APPID')
}
export function apiKey(): string {
  return secret('XFYUN_API_KEY')
}
export function apiSecret(): string {
  return secret('XFYUN_API_SECRET')
}
export function maasApiKey(): string {
  return secret('XFYUN_MAAS_API_KEY')
}

/** 给界面用的状态摘要（绝不含任何密钥值）。 */
export function configSummary(): { ready: boolean; missing: string[] } {
  return { ready: CREDENTIALS_READY, missing: [...MISSING_KEYS] }
}

/**
 * H5 开发预览是否可用本机代理跑云能力。
 * 浏览器包里没有任何密钥，识别 / 抽取由 `npm run dev:h5` 的 vite 中间件签名转发。
 */
export function devProxyAvailable(): boolean {
  // #ifdef APP-PLUS
  return false
  // #endif
  // #ifndef APP-PLUS
  return Boolean(import.meta.env.DEV)
  // #endif
}

/** 云能力是否可用（App 凭据就绪，或 H5 开发预览走了本机代理）。 */
export function cloudAvailable(): boolean {
  return CREDENTIALS_READY || devProxyAvailable()
}

/**
 * 构建期密钥处理核心（Node 侧脚本，不进入 APK、不含任何明文密钥）。
 *
 * 方案 C 安全链路：
 *   docs/讯飞接口配置.md（本地、gitignore）
 *     --sync-env--> .env.local（本地、gitignore，唯一允许出现真实值的文件）
 *     --gen-runtime-config--> src/api/generated/credentials.ts（本地、gitignore）
 *       → 明文整串密钥被「分片 + 异或变换」打散，产物 JS 中不出现整串
 *     --Vite/HBuilderX 编译--> APK（运行时拼接还原）
 *
 * 本文件绝不把任何密钥值输出到 stdout / 日志 / 仓库文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(HERE, '..')
export const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..')
export const GENERATED_DIR = path.join(PROJECT_ROOT, 'src/api/generated')
export const GENERATED_FILE = path.join(GENERATED_DIR, 'credentials.ts')

/** .env 键名唯一来源：.env.example。真实值只能来自 .env.local。 */
export const SECRET_KEYS = [
  'XFYUN_MAAS_API_KEY',
  'XFYUN_APPID',
  'XFYUN_API_KEY',
  'XFYUN_API_SECRET',
]
export const PUBLIC_KEYS = [
  'XFYUN_MAAS_BASE_URL',
  'XFYUN_MAAS_MODEL',
  'XFYUN_IAT_WSS',
  'XFYUN_TTS_WSS',
  'XFYUN_TTS_VCN_ZH',
  'XFYUN_TTS_VCN_EN',
  'XFYUN_OCR_URL',
  'XFYUN_OCR_SIGN_HOST',
]

/** 解析 KEY=VALUE，忽略注释与空行；值可含 = 号，去掉成对引号。 */
export function parseEnv(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 1) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

/** 读取 .env.local：优先工程根，其次工作区根。绝不打印内容。 */
export function loadLocalEnv() {
  const candidates = [
    path.join(PROJECT_ROOT, '.env.local'),
    path.join(WORKSPACE_ROOT, '.env.local'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return { file: p, env: parseEnv(fs.readFileSync(p, 'utf8')) }
  }
  return { file: null, env: {} }
}

/**
 * 从凭据文档解析真实值（只在本机运行，结果只写进 .env.local）。
 * 正则与 tools/probe_xfyun.py 的 load_creds() 保持一致。
 * 注意：本函数返回值只在内存中传递，不打印、不写入除 .env.local 外的任何文件。
 */
export function readCredentialsFromDoc(docPath = path.join(WORKSPACE_ROOT, 'docs/讯飞接口配置.md')) {
  if (!fs.existsSync(docPath)) throw new Error('找不到凭据文档：' + docPath)
  const text = fs.readFileSync(docPath, 'utf8')
  const field = (label) => {
    const m = text.match(new RegExp('\\|\\s*' + label + '\\s*\\|\\s*`([^`]+)`'))
    if (!m) throw new Error('凭据文档中未找到字段: ' + label)
    return m[1].trim()
  }
  const maas = text.match(/Authorization:\s*Bearer\s+(ak-[0-9a-zA-Z]+)/)
  if (!maas) throw new Error('凭据文档中未找到 MaaS API Key')
  return {
    XFYUN_MAAS_API_KEY: maas[1],
    XFYUN_APPID: field('APPID'),
    XFYUN_API_SECRET: field('APISecret'),
    XFYUN_API_KEY: field('APIKey'),
  }
}

/** 把 .env.example 的键名模板 + 凭据文档真实值合成为 .env.local 内容。
 *  previous：已存在的 .env.local 值。发音人属于人工标定项，重新生成时保留已有取值，
 *  否则每次 prepare:env 都会把联调结论覆盖回占位符。 */
export function buildEnvLocal({ withCredentials = true, previous = {} } = {}) {
  const tplPath = path.join(WORKSPACE_ROOT, '.env.example')
  const tpl = fs.existsSync(tplPath) ? fs.readFileSync(tplPath, 'utf8') : ''
  const base = parseEnv(tpl)
  const values = { ...base }
  // 发音人不是密钥；实测可用的默认值，联调时可在 .env.local 覆盖
  const pick = (k, fallback) => {
    const prev = previous[k]
    if (prev && !/REPLACE_ME/.test(prev)) { values[k] = prev; return }
    if (!values[k] || /REPLACE_ME/.test(values[k])) values[k] = fallback
  }
  pick('XFYUN_TTS_VCN_ZH', 'x5_lingxiaoxuan_flow')
  pick('XFYUN_TTS_VCN_EN', 'x5_EnUs_Grant_flow')
  if (withCredentials) Object.assign(values, readCredentialsFromDoc())
  const lines = [
    '# 由 npm run prepare:env 自动生成；含真实凭据，已被 .gitignore 排除。',
    '# 请勿提交、请勿截图、请勿写入日志。真实值来源：docs/讯飞接口配置.md',
    ...Object.entries(values).map(([k, v]) => `${k}=${v}`),
    '',
  ]
  return lines.join('\n')
}

/** xorshift32 派生异或流：轻量可逆变换，目的是让产物里不出现明文整串。 */
function keystream(seed, n) {
  let x = seed >>> 0 || 0x9e3779b9
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    out[i] = x & 0xff
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function b64encode(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    s += B64[a >> 2]
    s += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    s += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    s += c === undefined ? '=' : B64[c & 63]
  }
  return s
}

/** 分片 + 异或：返回 5 段字符串；任何一段都不含完整密钥。 */
export function shard(value, seed) {
  const bytes = Buffer.from(String(value), 'utf8')
  const ks = keystream(seed, bytes.length)
  const mixed = Buffer.from(bytes.map((b, i) => b ^ ks[i]))
  const encoded = b64encode(mixed)
  const size = Math.ceil(encoded.length / 5) || 1
  const parts = []
  for (let i = 0; i < encoded.length; i += size) parts.push(encoded.slice(i, i + size))
  while (parts.length < 5) parts.push('')
  return parts
}

const GENERATED_HEADER = `/* 自动生成，请勿编辑、请勿提交。本文件由 scripts/gen-runtime-config.mjs 生成，
 * 已被 .gitignore 排除。内容只是分片 + 异或变换后的片段，不含任何明文整串密钥。
 * 运行时由 reveal() 拼接还原；配合代码混淆与打包加固使用。 */`

/** 生成 credentials.ts 源码；不向任何日志输出密钥值。 */
export function renderGenerated(env) {
  const missing = SECRET_KEYS.filter((k) => !env[k] || /REPLACE_ME|^\s*$/.test(env[k]))
  const seed = 0x5f3a7c91
  const packs = {}
  for (const k of SECRET_KEYS) packs[k] = shard(env[k] || '', seed + k.length * 7919)
  const pub = {}
  for (const k of PUBLIC_KEYS) pub[k] = env[k] || ''

  return `${GENERATED_HEADER}

const PACKS: Record<string, string[]> = ${JSON.stringify(packs, null, 2)};
const SEED = ${seed};
export const PUBLIC_CONFIG: Record<string, string> = ${JSON.stringify(pub, null, 2)};
export const CREDENTIALS_READY = ${missing.length === 0 ? 'true' : 'false'};
export const MISSING_KEYS: string[] = ${JSON.stringify(missing)};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = i + 1 < clean.length ? B64.indexOf(clean[i + 1]) : -1;
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    const n = (a << 18) | ((b < 0 ? 0 : b) << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (p < out.length) out[p++] = (n >> 16) & 255;
    if (b >= 0 && p < out.length) out[p++] = (n >> 8) & 255;
    if (c >= 0 && p < out.length) out[p++] = n & 255;
  }
  return out.slice(0, p);
}

function stream(seed: number, n: number): Uint8Array {
  let x = seed >>> 0 || 0x9e3779b9;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 255;
  }
  return out;
}

function utf8(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    if (a < 0x80) s += String.fromCharCode(a);
    else if (a < 0xe0) s += String.fromCharCode(((a & 31) << 6) | (bytes[i++] & 63));
    else if (a < 0xf0) s += String.fromCharCode(((a & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    else {
      const cp = ((a & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      const v = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 1023));
    }
  }
  return s;
}

/** 运行时按 key 拼接还原配置值；分离出的片段永不以整串形式出现在产物中。 */
export function reveal(key: string): string {
  const parts = PACKS[key];
  if (!parts) return '';
  const raw = b64decode(parts.join(''));
  const ks = stream(SEED + key.length * 7919, raw.length);
  for (let i = 0; i < raw.length; i++) raw[i] ^= ks[i];
  return utf8(raw);
}
`
}

/** 生成（若 .env.local 不存在则保留已有生成文件，供 HBuilderX 云打包使用）。 */
export function generateCredentials() {
  const { file, env } = loadLocalEnv()
  if (!file) {
    if (fs.existsSync(GENERATED_FILE)) return { ok: true, source: 'existing-generated' }
    return { ok: false, reason: 'missing-.env.local' }
  }
  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  fs.writeFileSync(GENERATED_FILE, renderGenerated(env), 'utf8')
  return { ok: true, source: 'generated', missing: SECRET_KEYS.filter((k) => !env[k] || /REPLACE_ME/.test(env[k])) }
}

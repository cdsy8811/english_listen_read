/**
 * H5 产物洁净检查：浏览器包里不得出现任何真实密钥明文或分片编码串。
 * 方案 C 的红线是「密钥只存在于产物 APK」；H5 仅用于本地界面预览。
 * 用法：npm run build:h5 && npm run verify:h5
 * 本脚本不打印任何密钥值，只打印命中数量与结论。
 */
import fs from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT, GENERATED_FILE, SECRET_KEYS, loadLocalEnv } from './credentials.mjs'

const H5_DIR = path.join(PROJECT_ROOT, 'dist/build/h5')
// 可传入其它产物目录做「阳性对照」：例如 node scripts/verify-h5-clean.mjs dist/build/app
const TARGET = process.argv[2] ? path.resolve(PROJECT_ROOT, process.argv[2]) : H5_DIR
if (!fs.existsSync(TARGET)) {
  console.error('未找到产物目录，请先运行 npm run build:h5')
  process.exit(1)
}

function walk(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs|html|json|css|map)$/i.test(p)) out.push(p)
  }
  return out
}

const files = walk(TARGET)
const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
const env = loadLocalEnv().env

// 1) 明文整串：一条都不允许
const plainHits = SECRET_KEYS.filter((k) => env[k] && text.includes(env[k])).length

// 2) 分片编码串：terser 可能把 5 段数组拆开或运行时拼接，故逐片段比对。
// 单个短片段可能与随机字符串偶合，因此以「任一密钥命中 ≥4 段 / 总命中 ≥4」为泄漏阈值。
const gen = fs.existsSync(GENERATED_FILE) ? fs.readFileSync(GENERATED_FILE, 'utf8') : ''
const packsMatch = gen.match(/const PACKS[^=]*=\s*(\{[\s\S]*?\});/)
let packs = {}
try { packs = packsMatch ? JSON.parse(packsMatch[1]) : {} } catch (_) { /* 解析失败按未就绪处理 */ }
const groups = Object.values(packs).filter((v) => Array.isArray(v))
const perKey = groups.map((parts) => parts.filter((s) => s && text.includes(s)).length)
const shardHits = perKey.reduce((a, b) => a + b, 0)
const shardsTotal = groups.reduce((a, parts) => a + parts.filter(Boolean).length, 0)
const fullKeyHit = perKey.some((n) => n >= 4)

// 3) 还原逻辑与就绪标记（占位版本不应存在）
// terser 会 mangle 掉 b64decode / PACKS / CREDENTIALS_READY 这些名字，
// 因此额外用 xorshift32 的种子常量（数字不会被改名）作为可靠兜底判定。
const readyTrue = /CREDENTIALS_READY\s*=\s*true/.test(text)
const xorshiftSeed = /0x9e3779b9|2654435769/.test(text)
const revealLogic = /function\s+b64decode|const\s+PACKS/.test(text) || xorshiftSeed

// 4) H5 不该出现任何直连讯飞的硬编码地址（clock 的 H5 分支已删除）
const cloudUrlHits = /xf-yun\.com/.test(text) ? 1 : 0

console.log(`扫描产物目录：${path.relative(PROJECT_ROOT, TARGET) || '.'}；文件数：${files.length}；比对密钥条目数：${SECRET_KEYS.length}（值不显示）`)
console.log(`明文整串命中：${plainHits === 0 ? '无' : plainHits + ' 处'}`)
console.log(`分片片段命中：${shardHits}/${shardsTotal}（任一密钥 ≥4 段：${fullKeyHit ? '是' : '否'}）`)
console.log(`凭据就绪标记（应为 false）：${readyTrue ? 'true（异常）' : 'false'}`)
console.log(`分片还原逻辑残留：${revealLogic ? '有（异常）' : '无'}`)
console.log(`讯飞地址硬编码残留：${cloudUrlHits === 0 ? '无' : '有（需复查）'}`)

// 阳性对照（App 产物）应命中分片；H5 产物必须全部为 0
const bad = plainHits > 0 || shardHits >= 4 || fullKeyHit || readyTrue || revealLogic || cloudUrlHits > 0
if (bad) {
  console.error('结论：该产物含密钥分片 / 明文，不可作为 H5 浏览器包使用')
  process.exit(1)
}
console.log('结论：该产物不含任何密钥明文 / 分片，可安全用于本地界面预览')

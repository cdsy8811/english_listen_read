/** npm run verify:secrets —— 仓库密钥自检。
 *  1) 扫描源码 / 配置 / 提交跟踪文件，确认不含真实密钥明文；
 *  2) 确认生成的分片文件不含整串明文；
 *  3) 确认 .gitignore 的三条排除规则未被删除。
 *  输出只报「有/无」，绝不打印命中内容或密钥值。 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { PROJECT_ROOT, WORKSPACE_ROOT, readCredentialsFromDoc, SECRET_KEYS, GENERATED_FILE } from './credentials.mjs'

let secrets = []
try {
  secrets = Object.values(readCredentialsFromDoc()).filter((v) => v && v.length >= 8)
} catch (e) {
  console.warn('凭据文档不可读，跳过明文比对：' + e.message)
}

const SKIP_DIR = new Set(['node_modules', 'unpackage', 'dist', '.git', '.hbuilderx', '__pycache__'])
const SCAN_EXT = /\.(ts|js|mjs|vue|json|md|scss|css|html|example|local)$/i

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (SCAN_EXT.test(name)) out.push(p)
  }
  return out
}

// 允许含真实值的文件：.env.local（本地、gitignore）、凭据文档（本地、gitignore）
const ALLOW = new Set([
  path.join(WORKSPACE_ROOT, 'docs/讯飞接口配置.md'),
  path.join(WORKSPACE_ROOT, '.env.local'),
  path.join(PROJECT_ROOT, '.env.local'),
])

const files = [
  ...walk(path.join(PROJECT_ROOT, 'src')),
  ...walk(path.join(PROJECT_ROOT, 'scripts')),
  path.join(PROJECT_ROOT, 'package.json'),
  path.join(PROJECT_ROOT, 'vite.config.ts'),
  path.join(WORKSPACE_ROOT, '.env.example'),
  path.join(WORKSPACE_ROOT, 'AGENTS.md'),
  path.join(WORKSPACE_ROOT, 'README.md'),
  ...walk(path.join(WORKSPACE_ROOT, 'docs')),
  ...walk(path.join(WORKSPACE_ROOT, 'tools')),
]

const leaks = []
for (const f of files) {
  if (!fs.existsSync(f) || ALLOW.has(f)) continue
  const text = fs.readFileSync(f, 'utf8')
  for (const s of secrets) {
    if (text.includes(s)) leaks.push(path.relative(WORKSPACE_ROOT, f))
  }
}

// git 跟踪文件里不能出现密钥文件
let trackedBad = []
try {
  const tracked = execFileSync('git', ['-C', WORKSPACE_ROOT, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  trackedBad = tracked.split(/\r?\n/).filter((l) =>
    /讯飞接口配置\.md$|\.env\.local$|\.apk$|\.keystore$|\.jks$/.test(l))
} catch (_) { /* 尚未初始化 git 仓库时跳过 */ }

const gi = fs.readFileSync(path.join(WORKSPACE_ROOT, '.gitignore'), 'utf8')
const giMissing = ['docs/讯飞接口配置.md', '.env.local', '*.apk']
  .filter((r) => !gi.includes(r))

console.log('扫描文件数：' + files.length + '；比对密钥条目数：' + secrets.length + '（值不显示）')
console.log('源码/文档明文泄漏：' + (leaks.length ? '发现 ' + leaks.length + ' 处 -> ' + leaks.join(', ') : '无'))
console.log('git 跟踪的敏感文件：' + (trackedBad.length ? trackedBad.join(', ') : '无'))
console.log('.gitignore 必需规则：' + (giMissing.length ? '缺少 ' + giMissing.join(', ') : '完整'))
console.log('分片文件存在：' + (fs.existsSync(GENERATED_FILE) ? '是' : '否（需先执行 prepare:env）'))
if (fs.existsSync(GENERATED_FILE)) {
  const t = fs.readFileSync(GENERATED_FILE, 'utf8')
  const whole = secrets.filter((s) => t.includes(s))
  console.log('分片文件含整串明文：' + (whole.length ? '是（不合格）' : '否'))
  if (whole.length) process.exitCode = 1
}
if (leaks.length || trackedBad.length || giMissing.length) process.exitCode = 1

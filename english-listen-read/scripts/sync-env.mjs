/** npm run prepare:env —— 生成本地 .env.local（唯一允许含真实值的文件，已 gitignore）。
 *  真实值从 docs/讯飞接口配置.md 读取；本脚本不打印任何密钥值。 */
import fs from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT, WORKSPACE_ROOT, buildEnvLocal, generateCredentials, parseEnv } from './credentials.mjs'

const targets = [path.join(PROJECT_ROOT, '.env.local'), path.join(WORKSPACE_ROOT, '.env.local')]
const target = targets.find((p) => fs.existsSync(p)) || targets[0]
const previous = fs.existsSync(target) ? parseEnv(fs.readFileSync(target, 'utf8')) : {}
const content = buildEnvLocal({ withCredentials: true, previous })
fs.writeFileSync(target, content, 'utf8')
console.log('已生成 .env.local（含真实凭据，已 gitignore；内容不显示）')

const gen = generateCredentials()
if (gen.ok) console.log('已生成分片配置：src/api/generated/credentials.ts（不含明文整串密钥）')
else console.warn('跳过分片生成：' + gen.reason)

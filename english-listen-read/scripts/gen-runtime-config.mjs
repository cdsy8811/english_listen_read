/** npm run prepare:config —— 构建期重新生成分片配置；不打印任何密钥。 */
import { generateCredentials } from './credentials.mjs'

const r = generateCredentials()
if (!r.ok) {
  console.error('生成失败：缺少 .env.local。请先执行 npm run prepare:env')
  process.exit(1)
}
console.log('分片配置就绪（来源：' + r.source + '，密钥值不显示）')
if (r.missing?.length) console.warn('以下键仍为占位值：' + r.missing.join(', '))

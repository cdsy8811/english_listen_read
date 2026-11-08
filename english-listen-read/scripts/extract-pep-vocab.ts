/**
 * 从 FreePEP 下载的人教社七年级英语教材 PDF 抽出的词汇表页面图片，
 * 逐页做「OCR → Spark X2.6 结构化抽取 → 按单元归类」，结果写到 tools/pep/extracted/。
 *
 * 只做数据加工，不修改 App；产物由 scripts/build-pep-vocab.mjs 组装成内置词库。
 * 密钥只在 Node 进程内使用，不打印；每页结果落盘，可断点续跑。
 *
 * 用法：node --experimental-strip-types scripts/extract-pep-vocab.ts [up|down|all]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ocrMarkdown } from './ocr-page.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PEP = path.resolve(ROOT, '../tools/pep')
const MD_DIR = path.join(PEP, 'md')
const OUT_DIR = path.join(PEP, 'extracted')
fs.mkdirSync(MD_DIR, { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const env = (() => {
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2]
  }
  return out
})()

/** 教材「Vocabulary in Each Unit」部分所在的 PDF 页码（已人工核对） */
const BOOKS = {
  // 仅「Vocabulary in Each Unit」页；其后是 Vocabulary A-Z / 小学词汇 / 参考词表，均为重复或超纲内容
  up: { dir: 'book_up', from: 116, to: 122, label: '七上' },
  down: { dir: 'book_down', from: 107, to: 115, label: '七下' },
} as const

const SYSTEM = '你是英语教材词汇表整理助手。只输出严格 JSON，不要解释、不要代码块。'

function buildPrompt(markdown: string, bookLabel: string): string {
  return [
    `下面是从《义务教育教科书 英语 七年级${bookLabel === '七上' ? '上册' : '下册'}》`,
    '「Vocabulary in Each Unit」词汇表某一页 OCR 出来的 markdown 文本（原书为左右两栏，OCR 后按行交错）。',
    '请抽取这一页的所有词条，只输出 JSON：',
    '{"items":[{"word":"mean","phonetic":"/miːn/","pos":"v.","translation":"意思是；打算","page":"27"}]}',
    '',
    '规则：',
    '1. page：该词条右侧印刷的页码（原文形如 p.27 或 27），只输出数字字符串。',
    '   页码常与词条分在不同表格单元格、甚至下一行，要按左右栏对应找回来；确实找不到填 ""。',
    '   不要输出 "p."、不要输出 PDF 页码。',
    '2. OCR 常把 IPA 音标识别成方框 / LaTeX 公式（如 $\\prime$、$\\square$），phonetic 必须**完全忽略原文音标**，',
    '   按单词重新写出标准英式 IPA，并用 /.../ 包裹。短语（如 play the guitar）phonetic 留空字符串。',
    '3. word 只保留英文词条本身，允许多个单词组成的短语；去掉序号、音标、词性、中文和页码。',
    '   专有名词（人名、地名、缩写如 PRC / WHO）也是词条，照常输出。',
    '4. pos 统一为缩写（n. / v. / adj. / adv. / prep. / pron. / conj. / interj. / num. / modal v. 等）；',
    '   原文带公式符号一律清掉；无法判断或短语填 ""。',
    '5. translation 只保留中文释义，多个义项沿用原标点；OCR 换行拆开的释义要接回一句，不能截断。',
    '6. 丢弃：右侧页码（p.21、21）、页眉页脚、出版社名、"注：……"说明文字、单独的大写字母索引（A、B、C）。',
    '7. 不要合并词条、不要编造词条；一行里若粘了两个词条，拆成两条。',
    '8. 加粗（**）只是重点词标记，不是词条内容，输出时去掉。',
    '9. unit：如果原文能看到单元标题（Starter Unit 1 / Unit 2 等），把该词条所属单元填进 unit；',
    '   看不到单元标题就填 "?"。此项仅作辅助，主要靠 page 判断单元。',
    '',
    'OCR 文本：',
    markdown.slice(0, 9000),
  ].join('\n')
}

interface Item { unit?: string; word: string; phonetic: string; pos: string; translation: string; page?: string }

async function extract(markdown: string, bookLabel: string): Promise<Item[]> {
  const url = `${String(env.XFYUN_MAAS_BASE_URL || '').replace(/\/$/, '')}/chat/completions`
  const body = {
    model: env.XFYUN_MAAS_MODEL || 'spark-x2.6',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt(markdown, bookLabel) },
    ],
    stream: false,
    temperature: 0.1,
    max_tokens: 4096,
    thinking: { type: 'disabled' },
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.XFYUN_MAAS_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`MaaS HTTP ${r.status}: ${text.slice(0, 200)}`)
  const json = JSON.parse(text) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> }
  const raw = json.choices?.[0]?.message?.content || ''
  const finish = json.choices?.[0]?.finish_reason
  if (finish === 'length') throw new Error('模型输出被 max_tokens 截断')
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`返回内容不是 JSON：${raw.slice(0, 120)}`)
  const obj = JSON.parse(cleaned.slice(start, end + 1)) as { items?: Item[] }
  if (!Array.isArray(obj.items)) throw new Error('返回缺少 items 数组')
  return obj.items
}

async function runBook(key: 'up' | 'down') {
  const b = BOOKS[key]
  for (let n = b.from; n <= b.to; n++) {
    const name = `${key}-${n}`
    const outFile = path.join(OUT_DIR, `${name}.json`)
    if (fs.existsSync(outFile)) {
      console.log(`${name} 已完成，跳过`)
      continue
    }
    const img = path.join(PEP, 'pages', b.dir, `${String(n).padStart(3, '0')}.jpg`)
    const mdFile = path.join(MD_DIR, `${name}.md`)
    let md = fs.existsSync(mdFile) ? fs.readFileSync(mdFile, 'utf8') : ''
    if (!md) {
      md = await ocrMarkdown(img)
      fs.writeFileSync(mdFile, md, 'utf8')
    }
    const items = await extract(md, b.label)
    fs.writeFileSync(outFile, JSON.stringify({ book: key, page: n, items }, null, 1), 'utf8')
    console.log(`${name}: OCR ${md.length} 字 → ${items.length} 词条`)
  }
}

async function main() {
  const which = (process.argv[2] || 'all') as 'up' | 'down' | 'all'
  if (which === 'up' || which === 'all') await runBook('up')
  if (which === 'down' || which === 'all') await runBook('down')
  console.log('完成，结果在', OUT_DIR)
}

void main().catch((e: Error) => { console.error('错误：' + e.message); process.exitCode = 1 })

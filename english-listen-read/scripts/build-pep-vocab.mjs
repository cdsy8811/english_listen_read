/**
 * 把逐页抽取结果（tools/pep/extracted/*.json）组装成 App 内置词库。
 *
 * 输入：scripts/extract-pep-vocab.ts 对教材「Vocabulary in Each Unit」逐页 OCR + X2.6 抽取的结果
 * 输出：
 *   src/data/vocab-pep7.ts                —— 随 APK 打包的 TS 数据模块
 *   data/人教版七上七下_教材词汇表.json    —— 同内容，可走首页「导入」路径
 *
 * 用法：node scripts/build-pep-vocab.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PEP = path.resolve(ROOT, '../tools/pep')
const SRC_DIR = path.join(PEP, 'extracted')

const RANGES = [
  { book: 'up', label: '七上', from: 116, to: 122 },
  { book: 'down', label: '七下', from: 107, to: 115 },
]

/** 教材目录里各单元的起始印刷页码：词条右侧的 p.XX 落在哪个区间，就归哪个单元。 */
const UNIT_STARTS = {
  七上: [
    { start: 1, name: 'Starter Unit 1' }, { start: 7, name: 'Starter Unit 2' },
    { start: 13, name: 'Starter Unit 3' }, { start: 19, name: 'Unit 1' },
    { start: 27, name: 'Unit 2' }, { start: 35, name: 'Unit 3' },
    { start: 43, name: 'Unit 4' }, { start: 51, name: 'Unit 5' },
    { start: 59, name: 'Unit 6' }, { start: 67, name: 'Unit 7' },
  ],
  七下: Array.from({ length: 8 }, (_, i) => ({ start: 1 + i * 8, name: `Unit ${i + 1}` })),
}
const UNIT_ORDER = [
  ...UNIT_STARTS['七上'].map((x) => `七上|${x.name}`),
  ...UNIT_STARTS['七下'].map((x) => `七下|${x.name}`),
]

function unitFromPage(label, page) {
  const list = UNIT_STARTS[label]
  let picked = list[0].name
  for (const u of list) if (page >= u.start) picked = u.name
  return picked
}

function cleanWord(s) {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/[`*_]/g, '')
    .replace(/^\s*\d+[.、)]\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/^['"]|['"]$/g, '')
    .trim()
}

function cleanPhonetic(s) {
  let v = String(s || '').trim()
  if (!v || /[☐□$\\]|square|prime/i.test(v)) return ''
  v = v.replace(/^\/|\/$/g, '').trim()
  if (!v || v.length > 45 || /[\u4e00-\u9fff]/.test(v)) return ''
  return v
}

function cleanPos(s) {
  const v = String(s || '').trim().replace(/[．。]/g, '.').replace(/[（(].*?[)）]/g, '').replace(/[^\w.& ]/gi, '').trim()
  return /^(n|v|adj|adv|prep|pron|conj|int|interj|num|art|aux|abbr|modal v|vt|vi)\.?(&\s*\w+\.?)?$/i.test(v) ? v : ''
}

function cleanTranslation(s) {
  return String(s || '')
    .replace(/p\.\s*\d+/gi, '')
    .replace(/\([^)]*[A-Za-z][^)]*\)/g, '')   // 去掉 (pl. ...) 等英文括注
    .replace(/\/[^/]{1,40}\//g, '')            // 去掉释义里夹带的音标
    .replace(/\|\|?/g, '；')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[；;，,、\s]+/, '')
    .replace(/[；;，,]\s*$/, '')
    .trim()
}

const rows = []
let skipped = 0
let withPage = 0
let withoutPage = 0
for (const r of RANGES) {
  let lastUnit = UNIT_STARTS[r.label][0].name
  for (let n = r.from; n <= r.to; n++) {
    const f = path.join(SRC_DIR, `${r.book}-${n}.json`)
    if (!fs.existsSync(f)) throw new Error(`缺少抽取结果：${f}`)
    const data = JSON.parse(fs.readFileSync(f, 'utf8'))
    for (const it of data.items) {
      const rawUnit = String(it.unit || '').trim()
      const heading = /^(starter\s+)?unit\s+\d+$/i.test(rawUnit) ? rawUnit : ''
      const page = parseInt(String(it.page || '').replace(/[^0-9]/g, ''), 10)
      const hasPage = Number.isFinite(page) && page > 0
      // 单元标题最可靠；其次用词条右侧印刷页码；都没有才沿用上一条
      let unit = heading || (hasPage ? unitFromPage(r.label, page) : lastUnit)
      if (heading) withPage++
      else if (hasPage) withPage++
      else withoutPage++
      lastUnit = unit
      const word = cleanWord(it.word)
      const translation = cleanTranslation(it.translation)
      if (!word || !/[A-Za-z]/.test(word)) { skipped++; continue }
      if (!/^[A-Za-z][A-Za-z' .-]*$/.test(word) || word.length > 40) { skipped++; continue }
      if (!/[\u4e00-\u9fff]/.test(translation)) { skipped++; continue }
      if (/^[A-Z]$/.test(word) || /^(p\.\s*)?\d+$/i.test(word)) { skipped++; continue }
      rows.push({
        unitKey: `${r.label}|${unit}`,
        word,
        phonetic: cleanPhonetic(it.phonetic),
        pos: cleanPos(it.pos),
        translation,
      })
    }
  }
}

// 全局去重（教材上下册有少量重复词，保留第一次出现）
const seen = new Set()
const unique = []
let dupes = 0
for (const x of rows) {
  const k = x.word.toLowerCase()
  if (seen.has(k)) { dupes++; continue }
  seen.add(k)
  unique.push(x)
}

// 按单元分组并排序
const groups = new Map()
for (const x of unique) {
  if (!groups.has(x.unitKey)) groups.set(x.unitKey, [])
  groups.get(x.unitKey).push(x)
}
const unitKeys = [...groups.keys()].sort((a, b) => {
  const ia = UNIT_ORDER.indexOf(a), ib = UNIT_ORDER.indexOf(b)
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b)
})

const BASE = 1_760_000_000_000
const units = []
const words = []
unitKeys.forEach((key, ui) => {
  const [label, unitName] = key.split('|')
  const slug = `${label === '七上' ? '7a' : '7b'}_${unitName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
  const id = `u_pep_${slug}`
  units.push({ id, title: `${label} ${unitName}`, source_img: '', created_at: BASE + (unitKeys.length - ui) * 1000 })
  groups.get(key).forEach((x, i) => {
    words.push({
      id: `w_pep_${slug}_${String(i + 1).padStart(3, '0')}`,
      unit_id: id,
      word: x.word,
      phonetic_uk: x.phonetic,
      phonetic_us: x.phonetic,
      pos: x.pos,
      translation: x.translation,
      example: '',
      audio_path: '',
      sort: i + 1,
      wrong: 0,
      wrong_count: 0,
    })
  })
})

const bundle = { version: 1, exported_at: Date.now(), units, words }
const ts = `/* 自动生成，请勿手改。
 * 数据来源：FreePEP 下载的《义务教育教科书 英语 七年级上册 / 下册》
 * 「Vocabulary in Each Unit」词汇表（逐页 OCR + 结构化抽取，音标由模型重生成）。
 * 教材版权归人民教育出版社，仅用于本机个人学习，不分发。
 * 生成链：scripts/extract-pep-vocab.ts → scripts/build-pep-vocab.mjs
 */
export const VOCAB_BUNDLE = ${JSON.stringify(bundle)}

export const VOCAB_UNITS = ${units.length}
export const VOCAB_WORDS = ${words.length}
`
fs.writeFileSync(path.join(ROOT, 'src/data/vocab-pep7.ts'), ts, 'utf8')
fs.writeFileSync(path.join(ROOT, 'data/人教版七上七下_教材词汇表.json'), JSON.stringify(bundle), 'utf8')

console.log(`单元 ${units.length} 个，词条 ${words.length} 条（标题/页码定位 ${withPage}，顺序推断 ${withoutPage}，跳过无效 ${skipped}，去重 ${dupes}）`)
for (const u of units) {
  const c = words.filter((w) => w.unit_id === u.id).length
  console.log(`  ${u.title.padEnd(22)} ${c} 词`)
}

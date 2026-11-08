import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeOcrResult, pickDocumentText } from '../src/api/xfyun-ocr.ts'
import { buildChatBody } from '../src/api/xfyun-maas.ts'
import { buildExtractPrompt, cleanPos, cleanPhonetic, normalizeDrafts, parseExtraction } from '../src/services/parser.ts'
import { parsePlainTextDrafts } from '../src/services/parser-text.ts'
import { utf8ToBase64 } from '../src/utils/crypto.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CACHE = path.resolve(HERE, '../../tools/ocr_last.json')

/** 模拟 P0 实测的 OCR 响应：text 是 base64 的 JSON，含 1 段 markdown + 大量 image 版面坐标。 */
function fakeOcrResponse(markdown: string) {
  const decoded = JSON.stringify({
    document: [{ name: 'markdown', value: markdown }],
    engine_version: 'se75ocrbm',
    image: Array.from({ length: 20 }, (_, i) => ({ block: i, coord: [i, i, i, i] })),
  })
  return {
    header: { code: 0, message: 'success', sid: 'sid-for-support' },
    payload: { result: { text: utf8ToBase64(decoded), encoding: 'utf8', compress: 'raw', format: 'plain' } },
  }
}

test('OCR 只取 document[].value 的 markdown，丢弃 image[] 版面坐标', () => {
  const md = '##### Word List\n| abandon | v. | 放弃；抛弃 |\n| benefit | n. | 益处；好处 |'
  const out = decodeOcrResult(fakeOcrResponse(md))
  assert.equal(out.markdown, md)
  assert.equal(out.sid, 'sid-for-support')
  assert.match(out.note, /取 document 文本/)
  assert.ok(!out.markdown.includes('engine_version'))
  assert.ok(!out.markdown.includes('coord'))
})

test('OCR 解码后不是 JSON 时原样当文本使用', () => {
  const out = pickDocumentText('纯文本识别结果')
  assert.equal(out.markdown, '纯文本识别结果')
  assert.match(out.note, /原样使用/)
})

test('header.code != 0 判失败并保留 sid；gzip 结果明确报错', () => {
  assert.throws(
    () => decodeOcrResult({ header: { code: 11200, message: '未授权', sid: 'sid-x' } }),
    /识别失败（code=11200）/,
  )
  assert.throws(
    () => decodeOcrResult({ header: { code: 0 }, payload: { result: { text: 'xxx', compress: 'gzip' } } }),
    /未启用 gzip 解压/,
  )
})

test('抽取 prompt 显式要求忽略 OCR 音标并按单词重生成 IPA', () => {
  const p = buildExtractPrompt('| abandon | /☐ bænd $\\square n/ | v.$ | 放弃 |')
  assert.match(p, /完全忽略原文里的音标|忽略 OCR 里的音标|忽略原文里的音标/)
  assert.match(p, /重新写出标准英式 IPA/)
  assert.match(p, /\/...\//)
  assert.match(p, /v\.\$/)
  assert.ok(p.includes('放弃'))
})

test('词性污染清洗：v.$ / n.$ / 公式残留 → 规范缩写', () => {
  assert.equal(cleanPos('v.$'), 'v.')
  assert.equal(cleanPos('n.$'), 'n.')
  assert.equal(cleanPos('v．'), 'v.')
  assert.equal(cleanPos('$\\square$'), '')
  assert.equal(cleanPos('adj.'), 'adj.')
  assert.equal(cleanPos('vt'), 'vt.')
  assert.equal(cleanPos(''), '')
})

test('音标损坏一律丢弃，正确的 IPA 保留并统一 /.../ 包裹', () => {
  for (const bad of ['/☐ bænd $\\square n/', '/ˈben ☐ f ☐ t/', '$\\square$', '']) {
    assert.equal(cleanPhonetic(bad), '')
  }
  assert.equal(cleanPhonetic('/əˈbændən/'), '/əˈbændən/')
  assert.equal(cleanPhonetic('ˈkæm(ə)rə'), '/ˈkæm(ə)rə/')
})

test('P0 实测：模型补全后的 3 条词条能完整通过清洗（音标 3/3 保留、词性规范化）', () => {
  const modelOutput = JSON.stringify({ items: [
    { word: 'abandon', phonetic: '/əˈbændən/', pos: 'v.', translation: '放弃；抛弃' },
    { word: 'benefit', phonetic: '/ˈbenɪfɪt/', pos: 'n.', translation: '益处；好处' },
    { word: 'camera', phonetic: '/ˈkæm(ə)rə/', pos: 'n.', translation: '照相机' },
  ] })
  const drafts = parseExtraction(modelOutput)
  assert.equal(drafts.length, 3)
  assert.deepEqual(drafts.map((d) => d.phonetic), ['/əˈbændən/', '/ˈbenɪfɪt/', '/ˈkæm(ə)rə/'])
  assert.deepEqual(drafts.map((d) => d.pos), ['v.', 'n.', 'n.'])
})

test('抽取结果容错：代码块围栏、重复词条、序号、乱码音标', () => {
  const raw = '```json\n{"items":[' +
    '{"word":"1. Abandon","phonetic":"/☐ bænd/","pos":"v.$","translation":"放弃"},' +
    '{"word":"abandon","phonetic":"/əˈbændən/","pos":"v.","translation":"抛弃"},' +
    '{"word":"","phonetic":"","pos":"","translation":""}' +
    ']}\n```'
  const drafts = parseExtraction(raw)
  assert.equal(drafts.length, 1) // 去重 + 丢空
  assert.equal(drafts[0].word, 'Abandon')
  assert.equal(drafts[0].pos, 'v.')
})

test('无网降级：手写文本按行解析出单词 / 词性 / 中文释义（音标丢弃，由校对页补）', () => {
  const text = [
    'Word List Unit 1',
    '1. abandon /əˈbændən/ v. 放弃；抛弃',
    '2. benefit n. 益处；好处',
    '| camera | /ˈkæmərə/ | n. | 照相机 |',
  ].join('\n')
  const drafts = parsePlainTextDrafts(text)
  assert.equal(drafts.length, 3)
  assert.deepEqual(drafts.map((d) => d.word), ['abandon', 'benefit', 'camera'])
  assert.equal(drafts[0].pos, 'v.')
  assert.equal(drafts[1].pos, 'n.')
  assert.equal(drafts[2].translation, '照相机')
})

test('P0 缓存的 markdown 能被正确送进抽取链路（不整包塞 JSON）', () => {
  if (!fs.existsSync(CACHE)) return // 缓存不存在时跳过
  const text = fs.readFileSync(CACHE, 'utf8')
  const md = JSON.parse(text) as string
  const out = decodeOcrResult(fakeOcrResponse(md))
  assert.equal(out.markdown, md)
  assert.ok(out.markdown.length < 1000, 'markdown 应远小于整包 6909 字')
  assert.ok(buildExtractPrompt(out.markdown).includes('abandon'))
})

test('normalizeDrafts 拒绝无 items / 非数组输入', () => {
  assert.deepEqual(normalizeDrafts([]), [])
  assert.throws(() => parseExtraction('{"foo":1}'), /缺少 items/)
})

// 2026-11-07 实测回归：X2.6 默认先输出 reasoning_content 并计费到 max_tokens，
// 1536 会被思考吃光 → content 为空、finish_reason=length，表现为「识别一直失败」。
test('结构化调用必须关闭思考并给足额度', () => {
  const body = buildChatBody([{ role: 'user', content: 'x' }], { maxTokens: 4096, thinking: 'disabled' }, 'spark-x2.6')
  assert.deepEqual(body.thinking, { type: 'disabled' })
  assert.equal(body.max_tokens, 4096)
  // 不传 thinking 时不应凭空加字段（兼容旧调用）
  assert.equal('thinking' in buildChatBody([], {}, 'spark-x2.6'), false)
})

test('抽取 prompt 明确要求丢弃页码、合并被断行的释义', () => {
  const p = buildExtractPrompt('magic /mædʒɪk/adj.有魔力的40')
  assert.match(p, /页码/)
  assert.match(p, /换行|断/)
  assert.match(p, /忽略原文里的音标/)
})

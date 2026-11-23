/**
 * 英文同音词判定（离线、纯数据 + 纯函数）。
 *
 * 为什么需要：2.2「看中说英」靠语音听写把作答转成文本，而听写只给文字、不给音素，
 * 对同一个读音会挑它认为更常见的拼法。2026-11-15 实测（干净合成音频、16k 单声道）：
 *   "two" 被听写成 "To."；同一批音频里 nbest=5 / wbest=5 对英文无效，每个词只回一个候选。
 * 也就是说「读的是 two、转写是 to」这种错不在用户，而是文本层面的同音歧义，
 * 若判成答错就是假阴性。2.2 只评内容正确度，这类读音完全相同的情况必须按正确计。
 *
 * 口径：只认「读音完全相同」的同音词。仅读音相近但不同的词（ship / sheep、cat / cut）
 * 仍然算错——那不是拼写差异，是读错了，不能靠同音表掩盖。
 *
 * 维护：新增一组就往 HOMOPHONE_GROUPS 里加一个数组（全小写、单个词、不含空格）。
 * 只覆盖教材词库里常见的那些，不追求全量英语。表中同一个词可以出现在多个组里
 * （read 既是 red 的过去式读音，也是 reed 的读音）。
 */

const HOMOPHONE_GROUPS: string[][] = [
  ['right', 'write', 'rite', 'wright'],
  ['red', 'read'],
  ['reed', 'read'],
  ['to', 'too', 'two'],
  ['there', 'their', 'theyre'],
  ['hear', 'here'],
  ['see', 'sea'],
  ['meet', 'meat'],
  ['week', 'weak'],
  ['way', 'weigh', 'whey'],
  ['sun', 'son'],
  ['by', 'buy', 'bye'],
  ['no', 'know'],
  ['new', 'knew', 'gnu'],
  ['one', 'won'],
  ['our', 'hour'],
  ['piece', 'peace'],
  ['break', 'brake'],
  ['dear', 'deer'],
  ['fair', 'fare'],
  ['hair', 'hare'],
  ['pair', 'pear'],
  ['plain', 'plane'],
  ['road', 'rode', 'rowed'],
  ['sail', 'sale'],
  ['tail', 'tale'],
  ['whole', 'hole'],
  ['wood', 'would'],
  ['blue', 'blew'],
  ['flour', 'flower'],
  ['aloud', 'allowed'],
  ['board', 'bored'],
  ['ceiling', 'sealing'],
  ['cereal', 'serial'],
  ['choose', 'chews'],
  ['cite', 'site', 'sight'],
  ['die', 'dye'],
  ['doe', 'dough'],
  ['feet', 'feat'],
  ['find', 'fined'],
  ['for', 'four', 'fore'],
  ['great', 'grate'],
  ['groan', 'grown'],
  ['hall', 'haul'],
  ['heal', 'heel'],
  ['heard', 'herd'],
  ['hire', 'higher'],
  ['need', 'knead'],
  ['not', 'knot'],
  ['nose', 'knows'],
  ['led', 'lead'],
  ['lesson', 'lessen'],
  ['loan', 'lone'],
  ['made', 'maid'],
  ['mail', 'male'],
  ['missed', 'mist'],
  ['none', 'nun'],
  ['or', 'oar', 'ore'],
  ['passed', 'past'],
  ['rain', 'reign', 'rein'],
  ['rose', 'rows'],
  ['scene', 'seen'],
  ['so', 'sew', 'sow'],
  ['stair', 'stare'],
  ['steal', 'steel'],
  ['sweet', 'suite'],
  ['some', 'sum'],
  ['through', 'threw'],
  ['toe', 'tow'],
  ['vain', 'vein', 'vane'],
  ['war', 'wore'],
  ['wear', 'where', 'ware'],
  ['which', 'witch'],
  ['your', 'youre', 'yore'],
  ['bare', 'bear'],
  ['beat', 'beet'],
  ['berry', 'bury'],
  ['cell', 'sell'],
  ['cent', 'scent', 'sent'],
  ['chord', 'cord'],
  ['climb', 'clime'],
  ['council', 'counsel'],
  ['current', 'currant'],
  ['days', 'daze'],
  ['earn', 'urn'],
  ['eight', 'ate'],
  ['eye', 'i'],
  ['fir', 'fur'],
  ['flew', 'flu', 'flue'],
  ['gate', 'gait'],
  ['genes', 'jeans'],
  ['guest', 'guessed'],
  ['in', 'inn'],
  ['knight', 'night'],
  ['leak', 'leek'],
  ['might', 'mite'],
  ['miner', 'minor'],
  ['morning', 'mourning'],
  ['muscle', 'mussel'],
  ['pact', 'packed'],
  ['pain', 'pane'],
  ['pause', 'paws'],
  ['peak', 'peek', 'pique'],
  ['pedal', 'peddle'],
  ['peer', 'pier'],
  ['plum', 'plumb'],
  ['pray', 'prey'],
  ['queue', 'cue'],
  ['quay', 'key'],
  ['rap', 'wrap'],
  ['rest', 'wrest'],
  ['ring', 'wring'],
  ['role', 'roll'],
  ['root', 'route'],
  ['rough', 'ruff'],
  ['seam', 'seem'],
  ['side', 'sighed'],
  ['sign', 'sine'],
  ['slay', 'sleigh'],
  ['soar', 'sore'],
  ['sole', 'soul'],
  ['stake', 'steak'],
  ['stationary', 'stationery'],
  ['straight', 'strait'],
  ['team', 'teem'],
  ['throne', 'thrown'],
  ['tide', 'tied'],
  ['time', 'thyme'],
  ['vale', 'veil'],
  ['waive', 'wave'],
  ['warn', 'worn'],
  ['whine', 'wine'],
  ['yoke', 'yolk'],
  ['you', 'ewe'],
  ['weight', 'wait'],
  ['whether', 'weather'],
  ['whose', 'whos'],
  ['colonel', 'kernel'],
  ['ok', 'okay', 'okey'],
]

/** 数字 → 英文数词：听写会把 two 写成 2，不归一化就永远对不上。 */
const NUMBER_WORDS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
  '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
  '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen',
  '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen', '20': 'twenty',
  '30': 'thirty', '40': 'forty', '50': 'fifty', '60': 'sixty', '70': 'seventy',
  '80': 'eighty', '90': 'ninety', '100': 'hundred', '1000': 'thousand',
}

/** 词 → 所在组的下标（一个词可在多组里）。 */
const GROUP_OF = new Map<string, number[]>()
HOMOPHONE_GROUPS.forEach((group, gi) => {
  for (const w of group) {
    const key = w.toLowerCase()
    const list = GROUP_OF.get(key)
    if (list) list.push(gi)
    else GROUP_OF.set(key, [gi])
  }
})

/** 单词归一化：小写、去标点与空格、去撇号（they're → theyre）。 */
export function phoneticWord(s: string): string {
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]/g, '')
}

/** 把独立数字替换成英文数词（2 → two）。 */
export function expandNumbers(s: string): string {
  return String(s || '').replace(/\d+/g, (m) => NUMBER_WORDS[m] ?? m)
}

/**
 * 两个「单词」是否读音完全相同。
 * 相同拼写也算 true（本函数只回答「读音是否一致」，不回答「是否不同拼法」）。
 */
export function isHomophone(a: string, b: string): boolean {
  const x = phoneticWord(expandNumbers(a))
  const y = phoneticWord(expandNumbers(b))
  if (!x || !y) return false
  if (x === y) return true
  const gx = GROUP_OF.get(x)
  const gy = GROUP_OF.get(y)
  if (!gx || !gy) return false
  return gx.some((gi) => gy.includes(gi))
}

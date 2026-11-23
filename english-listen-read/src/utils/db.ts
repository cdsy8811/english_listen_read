/**
 * 本地数据层：plus.sqlite（App 端）+ 内存/Storage 降级（H5 预览 / 无 SQLite 环境）。
 * 十一张表：unit / word / practice_record / settings / media_cache / dict_cache / dict_history /
 * gloss_cache / read_article / read_record / study_session。
 * 断网时首页、词条、错词本、设置、练习记录、已缓存词典释义、跟读文章全部可用 —— 本地优先，云能力按需。
 */
import { errText, logger } from './log.ts'

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS unit (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, source_img TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS word (
    id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, word TEXT NOT NULL,
    phonetic_uk TEXT DEFAULT '', phonetic_us TEXT DEFAULT '', pos TEXT DEFAULT '',
    translation TEXT DEFAULT '', example TEXT DEFAULT '', audio_path TEXT DEFAULT '',
    sort INTEGER DEFAULT 0, wrong INTEGER DEFAULT 0, wrong_count INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_word_unit ON word(unit_id, sort)`,
  `CREATE TABLE IF NOT EXISTS practice_record (
    id TEXT PRIMARY KEY, word_id TEXT NOT NULL, mode TEXT NOT NULL,
    input_type TEXT DEFAULT '', raw_text TEXT DEFAULT '', asr_text TEXT DEFAULT '',
    score INTEGER DEFAULT 0, detail_json TEXT DEFAULT '', created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_record_word ON practice_record(word_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // 朗读音频缓存：expired_at = 0 表示永不过期（按容量 LRU 淘汰，不再按天过期）；
  // bytes / hits / last_used_at 用于容量统计、命中统计与淘汰排序
  `CREATE TABLE IF NOT EXISTS media_cache (
    text_hash TEXT NOT NULL, lang TEXT NOT NULL, vcn TEXT NOT NULL,
    speed INTEGER NOT NULL, path TEXT NOT NULL, expired_at INTEGER NOT NULL,
    bytes INTEGER DEFAULT 0, hits INTEGER DEFAULT 0, last_used_at INTEGER DEFAULT 0,
    PRIMARY KEY (text_hash, lang, vcn, speed)
  )`,
  // 词典释义缓存：key = 语言 + 规范化查询词，断网时仍能查已查过的词
  `CREATE TABLE IF NOT EXISTS dict_cache (
    id TEXT PRIMARY KEY, query TEXT NOT NULL, lang TEXT NOT NULL,
    payload TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  // 词典查询历史：一个查询词一行，重复查询只更新时间
  `CREATE TABLE IF NOT EXISTS dict_history (
    id TEXT PRIMARY KEY, query TEXT NOT NULL, lang TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  // 点词速览：只存「音标 + 1–3 条中文释义」，与完整词典条目分开，避免把简版当完整条目命中
  `CREATE TABLE IF NOT EXISTS gloss_cache (
    id TEXT PRIMARY KEY, word TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  // 学习记录：一次练习 / 跟读算一条，记时长与作答概况，供「我的 → 学习记录」回看
  `CREATE TABLE IF NOT EXISTS study_session (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, mode TEXT DEFAULT '', unit_id TEXT DEFAULT '',
    title TEXT DEFAULT '', started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
    duration_sec INTEGER DEFAULT 0, total INTEGER DEFAULT 0, answered INTEGER DEFAULT 0,
    passed INTEGER DEFAULT 0, avg_score INTEGER DEFAULT 0, created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_time ON study_session(started_at)`,
  // 跟读文章：content 存句子数组的 JSON，translations 存逐句中文译文（等长 JSON 数组），一次添加可反复练
  `CREATE TABLE IF NOT EXISTS read_article (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, source_img TEXT DEFAULT '',
    content TEXT NOT NULL, translations TEXT DEFAULT '[]', created_at INTEGER NOT NULL
  )`,
  // 跟读记录：一句一录，sentence_index 从 0 开始
  `CREATE TABLE IF NOT EXISTS read_record (
    id TEXT PRIMARY KEY, article_id TEXT NOT NULL, sentence_index INTEGER DEFAULT 0,
    asr_text TEXT DEFAULT '', score INTEGER DEFAULT 0, detail_json TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_read_record ON read_record(article_id, created_at)`,
]

const DB_NAME = 'english-listen-read'
const DB_PATH = '_doc/english-listen-read.db'

export interface DbAdapter {
  exec(sql: string, params?: unknown[]): Promise<void>
  all<T>(sql: string, params?: unknown[]): Promise<T[]>
  /** 批量写入走事务，避免半截数据 */
  tx(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>
  readonly kind: 'sqlite' | 'memory'
}

/** 内存降级：以 JSON 快照持久化，语义与 SQLite 版一致（本服务只用到固定 SQL）。 */
interface Snapshot {
  unit: Record<string, unknown>[]
  word: Record<string, unknown>[]
  practice_record: Record<string, unknown>[]
  settings: Record<string, unknown>[]
  media_cache: Record<string, unknown>[]
  dict_cache: Record<string, unknown>[]
  dict_history: Record<string, unknown>[]
  gloss_cache: Record<string, unknown>[]
  read_article: Record<string, unknown>[]
  read_record: Record<string, unknown>[]
  study_session: Record<string, unknown>[]
}

const TABLES: (keyof Snapshot)[] = [
  'unit', 'word', 'practice_record', 'settings', 'media_cache', 'dict_cache', 'dict_history',
  'gloss_cache', 'read_article', 'read_record', 'study_session',
]

function emptySnapshot(): Snapshot {
  return {
    unit: [], word: [], practice_record: [], settings: [], media_cache: [],
    dict_cache: [], dict_history: [], gloss_cache: [], read_article: [], read_record: [],
    study_session: [],
  }
}

/** 极简 SQL 子集执行器：只处理本工程固定写法的 SELECT/INSERT/UPDATE/DELETE。
 *  仅用于 H5 预览与 Node 自测；App 端一律走 plus.sqlite。 */
function samePrimary(table: string, a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (table === 'media_cache') {
    return a.text_hash === b.text_hash && a.lang === b.lang && a.vcn === b.vcn
      && Number(a.speed) === Number(b.speed)
  }
  return a.id !== undefined && a.id === b.id
}

class MemoryDb implements DbAdapter {
  readonly kind = 'memory' as const
  private data: Snapshot = emptySnapshot()
  private persist?: (s: Snapshot) => void
  constructor(persist?: (s: Snapshot) => void, initial?: Partial<Snapshot>) {
    this.persist = persist
    // H5 预览会把快照存进 localStorage；旧版本快照可能缺后续新增的表
    // （read_article / dict_* 等），这里补空数组，避免 `.filter` of undefined。
    if (initial) this.data = { ...emptySnapshot(), ...initial }
  }
  private tableOf(sql: string): keyof Snapshot {
    const m = /(?:FROM|INTO|UPDATE)\s+(\w+)/i.exec(sql)
    const t = (m?.[1] || '') as keyof Snapshot
    if (!TABLES.includes(t)) throw new Error('不支持的表: ' + t)
    return t
  }
  private flush() { this.persist?.(this.data) }
  async exec(sql: string, params: unknown[] = []): Promise<void> {
    const head = sql.trim().slice(0, 12).toUpperCase()
    if (head.startsWith('CREATE')) return
    if (head.startsWith('INSERT') || head.startsWith('REPLACE')) {
      const t = this.tableOf(sql)
      const cols = /\((\w+(?:,\s*\w+)*)\)\s*VALUES/i.exec(sql)?.[1].split(',').map((s) => s.trim()) || []
      const row: Record<string, unknown> = {}
      cols.forEach((c, i) => { row[c] = params[i] })
      this.data[t] = this.data[t] || []
      // 与 SQLite 主键语义对齐：media_cache 是四列联合主键，其余表用 id。
      // 不做这层去重，音频缓存命中时的 hits / last_used_at 回写会插出重复行。
      if (this.data[t].length) this.data[t] = this.data[t].filter((r) => !samePrimary(t, r, row))
      this.data[t].push(row)
    } else if (head.startsWith('UPDATE')) {
      const t = this.tableOf(sql)
      const setPart = /SET\s+(.+?)\s+WHERE/i.exec(sql)?.[1] || ''
      const assigns = setPart.split(',').map((s) => s.trim())
      const whereCol = /WHERE\s+(\w+)\s*=\s*\?/i.exec(sql)?.[1]
      const whereVal = params[params.length - 1]
      for (const row of (this.data[t] || [])) {
        if (whereCol && row[whereCol] !== whereVal) continue
        assigns.forEach((a, i) => {
          const c = a.split('=')[0].trim()
          const expr = a.split('=').slice(1).join('=').trim()
          if (/\?/.test(expr)) row[c] = params[i]
          else {
            // 支持 `col + 1` 形式的自增（错词计数）
            const inc = /^(\w+)\s*\+\s*(\d+)$/.exec(expr)
            if (inc) row[c] = (Number(row[inc[1]]) || 0) + Number(inc[2])
            else row[c] = typeof row[c] === 'number' ? Number(expr) : expr
          }
        })
      }
    } else if (head.startsWith('DELETE')) {
      const t = this.tableOf(sql)
      const whereCol = /WHERE\s+(\w+)\s*=\s*\?/i.exec(sql)?.[1]
      const whereVal = params[0]
      if (whereCol) this.data[t] = (this.data[t] || []).filter((r) => r[whereCol] !== whereVal)
      else this.data[t] = []
    }
    this.flush()
  }
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const t = this.tableOf(sql)
    let rows = [...(this.data[t] || [])]
    const wheres = /WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i.exec(sql)?.[1]
    if (wheres) {
      const conds = wheres.split(/\s+AND\s+/i)
      let pi = 0
      for (const cond of conds) {
        const like = /(\w+)\s+LIKE\s+\?/i.exec(cond)
        const eq = /(\w+)\s*=\s*\?/i.exec(cond)
        const eqLit = /(\w+)\s*=\s*(\d+)\s*$/i.exec(cond)
        if (like) {
          const v = String(params[pi++] ?? '').replace(/%/g, '').toLowerCase()
          rows = rows.filter((r) => String(r[like[1]] ?? '').toLowerCase().includes(v))
        } else if (eq) {
          const v = params[pi++]
          rows = rows.filter((r) => r[eq[1]] === v)
        } else if (eqLit) {
          const v = Number(eqLit[2])
          rows = rows.filter((r) => Number(r[eqLit[1]]) === v)
        }
      }
    }
    const order = /ORDER\s+BY\s+(\w+)\s*(ASC|DESC)?/i.exec(sql)
    if (order) {
      const col = order[1], desc = (order[2] || '').toUpperCase() === 'DESC'
      rows.sort((a, b) => {
        const x = a[col] as number | string, y = b[col] as number | string
        return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1)
      })
    }
    const limit = /LIMIT\s+(\d+)/i.exec(sql)
    if (limit) rows = rows.slice(0, Number(limit[1]))
    return rows as T[]
  }
  async tx(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    for (const s of statements) await this.exec(s.sql, s.params || [])
  }
  snapshot(): Snapshot { return this.data }
}

/**
 * plus.sqlite 的最小类型面：@dcloudio/types 对各版本 5+ runtime 的声明不稳定，
 * 统一在这里断言，避免把 any 扩散到仓储层。
 *
 * 注意：官方 API 里 `transaction` 的 `operation` 是 'begin' | 'commit' | 'rollback'，
 * 不是"传入 tx 回调"（那是别的库的写法）；`executeSql/selectSql` 也没有稳定的 args 参数。
 * 因此这里统一把参数内联成 SQL 字面量（单引号转义），只用文档化的调用方式。
 */
interface SqliteBridge {
  openDatabase: (o: { name: string; path: string; success: () => void; fail: (e: unknown) => void }) => void
  executeSql: (o: { name: string; sql: string | string[]; success: () => void; fail: (e: unknown) => void }) => void
  selectSql: (o: { name: string; sql: string; success: (r: unknown[]) => void; fail: (e: unknown) => void }) => void
  transaction: (o: {
    name: string
    operation: 'begin' | 'commit' | 'rollback'
    success: () => void
    fail: (e: unknown) => void
  }) => void
}
function sqlite(): SqliteBridge {
  return (plus as unknown as { sqlite: SqliteBridge }).sqlite
}

/** 绑定值 → SQL 字面量：null/undefined 用 NULL，字符串按 SQLite 规则双写单引号。 */
function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${String(v).replace(/'/g, "''")}'`
}

/** 把 `?` 占位符按顺序替换成字面量（本工程的 SQL 都是固定写法，不会在字符串里出现 ?）。 */
function inlineParams(sql: string, params: unknown[]): string {
  if (!params.length) return sql
  let i = 0
  return sql.replace(/\?/g, () => (i < params.length ? sqlLiteral(params[i++]) : 'NULL'))
}

/** App 端 plus.sqlite 适配器。 */
class SqliteDb implements DbAdapter {
  readonly kind = 'sqlite' as const
  private ready: Promise<void> | null = null
  private open(): Promise<void> {
    if (this.ready) return this.ready
    const t0 = Date.now()
    logger.debug('db.open.start', { name: DB_NAME, path: DB_PATH })
    const p = new Promise<void>((resolve, reject) => {
      sqlite().openDatabase({
        name: DB_NAME, path: DB_PATH,
        success: () => {
          logger.debug('db.open.ok', { name: DB_NAME, ms: Date.now() - t0 })
          resolve()
        },
        fail: (e) => {
          const code = (e as { code?: number })?.code
          const msg = errText(e)
          // -1402「Same Name Already Open」：热重载 / 二次启动时原生库仍是打开状态，
          // 等同于打开成功；否则整条 SQL 链路会一直失败。
          if (code === -1402 || /already\s*open/i.test(msg)) {
            logger.warn('db.open.reuse', { name: DB_NAME, ms: Date.now() - t0 })
            resolve()
            return
          }
          logger.error('db.open.fail', { name: DB_NAME, ms: Date.now() - t0, code, msg })
          reject(new Error('SQLite 打开失败: ' + JSON.stringify(e)))
        },
      })
    })
    this.ready = p
    // 真失败时清掉缓存的 rejected Promise，下次调用还能重试
    p.catch(() => { if (this.ready === p) this.ready = null })
    return p
  }
  private runSql(sql: string | string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      sqlite().executeSql({
        name: DB_NAME, sql,
        success: () => resolve(),
        fail: (e) => reject(new Error('SQL 执行失败: ' + JSON.stringify(e))),
      })
    })
  }

  private txCommand(operation: 'begin' | 'commit' | 'rollback'): Promise<void> {
    return new Promise((resolve, reject) => {
      sqlite().transaction({
        name: DB_NAME, operation,
        success: () => resolve(),
        fail: (e) => reject(new Error(`事务 ${operation} 失败: ` + JSON.stringify(e))),
      })
    })
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.open()
    await this.runSql(inlineParams(sql, params))
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.open()
    const finalSql = inlineParams(sql, params)
    return new Promise((resolve, reject) => {
      sqlite().selectSql({
        name: DB_NAME, sql: finalSql,
        success: (res) => resolve((res || []) as T[]),
        fail: (e) => reject(new Error('SQL 查询失败: ' + JSON.stringify(e))),
      })
    })
  }

  /**
   * 批量写入：begin → 一次性执行 SQL 数组（HBuilderX 2.5.5+）→ commit，失败则 rollback。
   * 数组形式比逐条 executeSql 少几百次跨线程调用，803 条词条也能很快落盘。
   */
  async tx(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    await this.open()
    if (!statements.length) return
    const sqls = statements.map((s) => inlineParams(s.sql, s.params || []))
    await this.txCommand('begin')
    try {
      await this.runSql(sqls)
      await this.txCommand('commit')
    } catch (e) {
      try { await this.txCommand('rollback') } catch (_) { /* 回滚失败时保留原始错误 */ }
      throw e
    }
  }
}

/** 从 SQL 里抽取「动词 + 表名」，只用于日志，不解析参数值（词条 / 答案不落日志）。 */
function sqlInfo(sql: string): { op: string; table: string } {
  const s = sql.trim().replace(/\s+/g, ' ')
  const op = (s.split(' ')[0] || '').toUpperCase()
  const m = /(?:\bON|\bFROM|\bINTO|\bUPDATE|\bTABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_]\w*)/i.exec(s)
  return { op, table: m ? m[1] : '-' }
}

/** 日志装饰器：所有 SQL 统一记录「动词 / 表 / 参数个数 / 行数 / 耗时」，不记录参数值。 */
class LoggedDb implements DbAdapter {
  private readonly inner: DbAdapter
  constructor(inner: DbAdapter) { this.inner = inner }
  get kind() { return this.inner.kind }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    const t0 = Date.now()
    const { op, table } = sqlInfo(sql)
    try {
      await this.inner.exec(sql, params)
      logger.debug('db.exec', { db: this.kind, op, table, params: params.length, ms: Date.now() - t0 })
    } catch (e) {
      logger.error('db.exec.fail', {
        db: this.kind, op, table, params: params.length, ms: Date.now() - t0, msg: errText(e),
      })
      throw e
    }
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const t0 = Date.now()
    const { op, table } = sqlInfo(sql)
    try {
      const rows = await this.inner.all<T>(sql, params)
      logger.debug('db.select', {
        db: this.kind, op, table, params: params.length, rows: rows.length, ms: Date.now() - t0,
      })
      return rows
    } catch (e) {
      logger.error('db.select.fail', {
        db: this.kind, op, table, params: params.length, ms: Date.now() - t0, msg: errText(e),
      })
      throw e
    }
  }

  async tx(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    const t0 = Date.now()
    const infos = statements.map((s) => sqlInfo(s.sql))
    const ops = [...new Set(infos.map((i) => i.op))].join('/')
    const tables = [...new Set(infos.map((i) => i.table))].join(',')
    const params = statements.reduce((n, s) => n + (s.params?.length || 0), 0)
    try {
      await this.inner.tx(statements)
      logger.debug('db.tx', { db: this.kind, stmts: statements.length, ops, tables, params, ms: Date.now() - t0 })
    } catch (e) {
      logger.error('db.tx.fail', {
        db: this.kind, stmts: statements.length, ops, tables, params, ms: Date.now() - t0, msg: errText(e),
      })
      throw e
    }
  }
}

let adapter: DbAdapter | null = null

/** 仅供 Node 侧自测注入内存库；App 运行时不走这里。 */
export function setDbForTest(db: DbAdapter): void {
  adapter = db
}

export function createMemoryDb(persist?: (s: Snapshot) => void, initial?: Partial<Snapshot>): DbAdapter {
  return new MemoryDb(persist, initial)
}

export function getDb(): DbAdapter {
  if (adapter) return adapter
  // #ifdef APP-PLUS
  adapter = new LoggedDb(new SqliteDb())
  // #endif
  // #ifndef APP-PLUS
  adapter = new LoggedDb(new MemoryDb((s) => {
    try { uni.setStorageSync('elr-db-snapshot', s) } catch (_) { /* 预览环境忽略 */ }
  }, (() => {
    try { return uni.getStorageSync('elr-db-snapshot') || undefined } catch (_) { return undefined }
  })()))
  // #endif
  return adapter
}

export async function initDatabase(): Promise<void> {
  const t0 = Date.now()
  const db = getDb()
  for (const sql of DDL) await db.exec(sql)
  await migrate(db)
  logger.info('db.ready', { kind: db.kind, tables: TABLES.length, ms: Date.now() - t0 })
}

/**
 * 老库补列。`CREATE TABLE IF NOT EXISTS` 只对新库生效，已有库的 media_cache 缺
 * bytes / hits / last_used_at 三列，音频缓存统计与 LRU 淘汰会直接报错。
 * 只做「加列」这一种安全迁移；内存降级库忽略 DDL，快照随写入自然扩展。
 */
const ADD_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'media_cache', column: 'bytes', ddl: 'ALTER TABLE media_cache ADD COLUMN bytes INTEGER DEFAULT 0' },
  { table: 'media_cache', column: 'hits', ddl: 'ALTER TABLE media_cache ADD COLUMN hits INTEGER DEFAULT 0' },
  { table: 'media_cache', column: 'last_used_at', ddl: 'ALTER TABLE media_cache ADD COLUMN last_used_at INTEGER DEFAULT 0' },
  { table: 'read_article', column: 'translations', ddl: "ALTER TABLE read_article ADD COLUMN translations TEXT DEFAULT '[]'" },
]

async function migrate(db: DbAdapter): Promise<void> {
  if (db.kind !== 'sqlite' || !ADD_COLUMNS.length) return
  for (const table of [...new Set(ADD_COLUMNS.map((c) => c.table))]) {
    let columns: string[] = []
    try {
      const rows = await db.all<{ name?: string }>(`PRAGMA table_info(${table})`)
      columns = rows.map((r) => String(r.name ?? ''))
    } catch (e) {
      logger.warn('db.migrate.probe.fail', { table, msg: errText(e) })
      continue
    }
    for (const c of ADD_COLUMNS.filter((x) => x.table === table)) {
      if (columns.includes(c.column)) continue
      try {
        await db.exec(c.ddl)
        logger.info('db.migrate.column', { table, column: c.column })
      } catch (e) {
        logger.warn('db.migrate.fail', { table, column: c.column, msg: errText(e) })
      }
    }
  }
}

/** 危险操作仅用于「清空本地数据」设置项，UI 需二次确认。 */
export async function clearAllData(): Promise<void> {
  const db = getDb()
  await db.tx(TABLES.map((t) => ({ sql: `DELETE FROM ${t}` })))
}

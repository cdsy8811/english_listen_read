/**
 * 本地数据层：plus.sqlite（App 端）+ 内存/Storage 降级（H5 预览 / 无 SQLite 环境）。
 * 五张表：unit / word / practice_record / settings / media_cache。
 * 断网时首页、词条、错词本、设置、练习记录全部可用 —— 本地优先，云能力按需。
 */
import { logger } from './log.ts'

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
  `CREATE TABLE IF NOT EXISTS media_cache (
    text_hash TEXT NOT NULL, lang TEXT NOT NULL, vcn TEXT NOT NULL,
    speed INTEGER NOT NULL, path TEXT NOT NULL, expired_at INTEGER NOT NULL,
    PRIMARY KEY (text_hash, lang, vcn, speed)
  )`,
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
}

const TABLES: (keyof Snapshot)[] = ['unit', 'word', 'practice_record', 'settings', 'media_cache']

function emptySnapshot(): Snapshot {
  return { unit: [], word: [], practice_record: [], settings: [], media_cache: [] }
}

/** 极简 SQL 子集执行器：只处理本工程固定写法的 SELECT/INSERT/UPDATE/DELETE。
 *  仅用于 H5 预览与 Node 自测；App 端一律走 plus.sqlite。 */
class MemoryDb implements DbAdapter {
  readonly kind = 'memory' as const
  private data: Snapshot = emptySnapshot()
  private persist?: (s: Snapshot) => void
  constructor(persist?: (s: Snapshot) => void, initial?: Snapshot) {
    this.persist = persist
    if (initial) this.data = initial
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
      const key = row.id as string | undefined
      if (key) this.data[t] = this.data[t].filter((r) => r.id !== key)
      this.data[t].push(row)
    } else if (head.startsWith('UPDATE')) {
      const t = this.tableOf(sql)
      const setPart = /SET\s+(.+?)\s+WHERE/i.exec(sql)?.[1] || ''
      const assigns = setPart.split(',').map((s) => s.trim())
      const whereCol = /WHERE\s+(\w+)\s*=\s*\?/i.exec(sql)?.[1]
      const whereVal = params[params.length - 1]
      for (const row of this.data[t]) {
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
      if (whereCol) this.data[t] = this.data[t].filter((r) => r[whereCol] !== whereVal)
      else this.data[t] = []
    }
    this.flush()
  }
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const t = this.tableOf(sql)
    let rows = [...this.data[t]]
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
 */
interface SqliteTx { executeSql: (sql: string, args?: unknown[]) => void }
interface SqliteBridge {
  openDatabase: (o: { name: string; path: string; success: () => void; fail: (e: unknown) => void }) => void
  executeSql: (o: { name: string; sql: string; args: unknown[]; success: () => void; fail: (e: unknown) => void }) => void
  selectSql: (o: { name: string; sql: string; args: unknown[]; success: (r: unknown[]) => void; fail: (e: unknown) => void }) => void
  transaction: (o: { name: string; operation: (tx: SqliteTx) => void; success: () => void; fail: (e: unknown) => void }) => void
}
function sqlite(): SqliteBridge {
  return (plus as unknown as { sqlite: SqliteBridge }).sqlite
}

/** App 端 plus.sqlite 适配器。 */
class SqliteDb implements DbAdapter {
  readonly kind = 'sqlite' as const
  private ready: Promise<void> | null = null
  private open(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve, reject) => {
      sqlite().openDatabase({
        name: DB_NAME, path: DB_PATH,
        success: () => resolve(),
        fail: (e) => reject(new Error('SQLite 打开失败: ' + JSON.stringify(e))),
      })
    })
    return this.ready
  }
  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.open()
    return new Promise((resolve, reject) => {
      sqlite().executeSql({
        name: DB_NAME, sql, args: params,
        success: () => resolve(),
        fail: (e) => reject(new Error('SQL 执行失败: ' + JSON.stringify(e))),
      })
    })
  }
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.open()
    return new Promise((resolve, reject) => {
      sqlite().selectSql({
        name: DB_NAME, sql, args: params,
        success: (res) => resolve((res || []) as T[]),
        fail: (e) => reject(new Error('SQL 查询失败: ' + JSON.stringify(e))),
      })
    })
  }
  async tx(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    await this.open()
    return new Promise((resolve, reject) => {
      sqlite().transaction({
        name: DB_NAME,
        operation: (tx) => {
          for (const s of statements) tx.executeSql(s.sql, s.params || [])
        },
        success: () => resolve(),
        fail: (e) => reject(new Error('事务失败: ' + JSON.stringify(e))),
      })
    })
  }
}

let adapter: DbAdapter | null = null

/** 仅供 Node 侧自测注入内存库；App 运行时不走这里。 */
export function setDbForTest(db: DbAdapter): void {
  adapter = db
}

export function createMemoryDb(persist?: (s: Snapshot) => void, initial?: Snapshot): DbAdapter {
  return new MemoryDb(persist, initial)
}

export function getDb(): DbAdapter {
  if (adapter) return adapter
  // #ifdef APP-PLUS
  adapter = new SqliteDb()
  // #endif
  // #ifndef APP-PLUS
  adapter = new MemoryDb((s) => {
    try { uni.setStorageSync('elr-db-snapshot', s) } catch (_) { /* 预览环境忽略 */ }
  }, (() => {
    try { return uni.getStorageSync('elr-db-snapshot') || undefined } catch (_) { return undefined }
  })())
  // #endif
  return adapter
}

export async function initDatabase(): Promise<void> {
  const db = getDb()
  for (const sql of DDL) await db.exec(sql)
  logger.info('db.ready', { kind: db.kind, tables: TABLES.length })
}

/** 危险操作仅用于「清空本地数据」设置项，UI 需二次确认。 */
export async function clearAllData(): Promise<void> {
  const db = getDb()
  await db.tx(TABLES.map((t) => ({ sql: `DELETE FROM ${t}` })))
}

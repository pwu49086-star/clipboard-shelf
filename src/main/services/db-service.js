/**
 * DB Service - better-sqlite3 + WAL + FTS5(trigram)
 *
 * 相比 sql.js：
 *  - 写入即时、原子、崩溃安全（WAL）
 *  - 英文长词走 FTS5（trigram），中文/短词回退 LIKE（子串匹配最稳）
 *  - 启动自动备份数据库和配置（保留 5 份）
 */

const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const { eventBus, Events } = require('../core/event-bus')
const encryption = require('./encryption-service')
const {
  ENTITY_TYPES,
  ENTITY_DISPLAY_INDEX,
  normalizeQuery
} = require('../../shared/entity-rules.cjs')

// ====== Schema migrations（user_version 框架） ======
const MIGRATIONS = [
  {
    version: 1,
    sql: [
      'ALTER TABLE items ADD COLUMN sourceApp TEXT',
      'ALTER TABLE items ADD COLUMN sourceProcess TEXT',
      'ALTER TABLE items ADD COLUMN capturedAt INTEGER',
      'ALTER TABLE items ADD COLUMN sensitivity INTEGER DEFAULT 0',
      'ALTER TABLE items ADD COLUMN metadataOnly INTEGER DEFAULT 0',
      'CREATE INDEX IF NOT EXISTS idx_items_source ON items(sourceApp)'
    ]
  },
  {
    version: 2,
    sql: [
      'ALTER TABLE items ADD COLUMN entityState INTEGER DEFAULT 0',
      `CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        match_type TEXT NOT NULL,
        createTime INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_entities_item ON entities(item_id)',
      'CREATE INDEX IF NOT EXISTS idx_entities_type_value ON entities(type, value)'
    ]
  },
  {
    version: 3,
    sql: [
      `CREATE TABLE IF NOT EXISTS worksites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        note TEXT DEFAULT '',
        archived INTEGER DEFAULT 0,
        createTime INTEGER NOT NULL,
        updateTime INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_worksites_update ON worksites(updateTime DESC)',
      'ALTER TABLE items ADD COLUMN worksiteId INTEGER',
      'CREATE INDEX IF NOT EXISTS idx_items_worksite ON items(worksiteId)'
    ]
  },
  {
    version: 4,
    sql: [
      'ALTER TABLE items ADD COLUMN annotatedPath TEXT',
      `CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        data TEXT NOT NULL,
        createTime INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_annotations_item ON annotations(item_id)'
    ]
  },
  {
    version: 5,
    sql: [
      "ALTER TABLE items ADD COLUMN assetState TEXT NOT NULL DEFAULT 'ok'",
      'ALTER TABLE items ADD COLUMN assetMissingAt INTEGER',
      "ALTER TABLE items ADD COLUMN assetMissingNote TEXT DEFAULT ''"
    ]
  }
]

function runMigrations() {
  if (!db) return
  let current = db.pragma('user_version', { simple: true })
  const migrate = db.transaction(() => {
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue
      for (const sql of m.sql) {
        try { db.exec(sql) } catch (e) {
          console.warn('[DBService] migration skip:', sql, e.message)
        }
      }
      db.pragma(`user_version = ${m.version}`)
      current = m.version
    }
  })
  migrate()
}

let electronApp = null
try { electronApp = require('electron').app } catch {}

// ====== State ======
let db = null
let dbPath = null

function userDataDir() {
  if (process.env.CLIPBOARD_SHELF_TEST_ROOT) return path.resolve(process.env.CLIPBOARD_SHELF_TEST_ROOT)
  if (process.env.CLIPBOARD_SHELF_USER_DATA && process.env.CLIPBOARD_SHELF_TEST_ROOT) return path.resolve(process.env.CLIPBOARD_SHELF_USER_DATA)
  if (process.env.CLIPBOARD_SHELF_USER_DATA) {
    console.warn('[RuntimeIsolation] Ignoring CLIPBOARD_SHELF_USER_DATA outside test mode')
  }
  try {
    if (electronApp) return electronApp.getPath('userData')
  } catch {}
  return path.join(require('os').tmpdir(), 'clipboard-shelf')
}

// ====== Backup ======
async function backupTo(dest) {
  if (!db) return { ok: false, error: 'db not open' }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    await db.backup(dest)
    const check = new Database(dest, { readonly: true })
    const ic = check.pragma('integrity_check', { simple: true })
    const pageCount = check.pragma('page_count', { simple: true })
    check.close()
    if (ic !== 'ok') return { ok: false, error: 'integrity_check: ' + ic }
    return { ok: true, pageCount }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function backupDatabase() {
  try {
    if (!db || !dbPath) return
    const backupDir = path.join(userDataDir(), 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const r = await backupTo(path.join(backupDir, `shelf-${ts}.db`))
    if (!r.ok) {
      console.error('[DBService] Backup error:', r.error)
      return
    }
    const cfgSrc = path.join(userDataDir(), 'config.json')
    if (fs.existsSync(cfgSrc)) {
      fs.copyFileSync(cfgSrc, path.join(backupDir, `config-${ts}.json`))
    }
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('shelf-') && f.endsWith('.db'))
      .sort()
    while (backups.length > 5) {
      try { fs.unlinkSync(path.join(backupDir, backups.shift())) } catch {}
    }
  } catch (err) {
    console.error('[DBService] Backup error:', err.message)
  }
}

// ====== FTS helpers ======
let stmtFtsInsert = null
let stmtFtsDelete = null

function syncFtsInsert(id, content, ocrText) {
  try { stmtFtsInsert.run(id, content || '', ocrText || '') } catch (e) {
    console.error('[DBService] FTS insert error:', e.message)
  }
}

function syncFtsDelete(id) {
  try { stmtFtsDelete.run(id) } catch (e) {
    console.error('[DBService] FTS delete error:', e.message)
  }
}

function syncFtsUpdate(id, content, ocrText) {
  syncFtsDelete(id)
  syncFtsInsert(id, content, ocrText)
}

function getItemOcrText(id) {
  const row = db.prepare('SELECT ocrText FROM items WHERE id = ?').get(id)
  return row ? row.ocrText : null
}

function getItemContent(id) {
  const row = db.prepare('SELECT content FROM items WHERE id = ?').get(id)
  return row ? row.content : null
}

function getItem(id) {
  if (!db || !Number.isInteger(id)) return null
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id)
  return row ? decryptRow(row) : null
}

function buildFtsQuery(search) {
  return search.split(/\s+/).filter(Boolean).map(t => '"' + t.replace(/"/g, '""') + '"').join(' ')
}

// ====== Init ======
async function init() {
  const userData = userDataDir()
  fs.mkdirSync(userData, { recursive: true })
  dbPath = path.join(userData, 'shelf.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      content TEXT,
      filePath TEXT,
      thumbPath TEXT,
      ocrText TEXT,
      isFavorite INTEGER DEFAULT 0,
      createTime INTEGER NOT NULL,
      fileSize INTEGER,
      imageWidth INTEGER,
      imageHeight INTEGER,
      sourceApp TEXT,
      sourceProcess TEXT,
      capturedAt INTEGER,
      sensitivity INTEGER DEFAULT 0,
      metadataOnly INTEGER DEFAULT 0,
      entityState INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
    CREATE INDEX IF NOT EXISTS idx_items_favorite ON items(isFavorite);
    CREATE INDEX IF NOT EXISTS idx_items_time ON items(createTime DESC);
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      color TEXT DEFAULT '#f5f0a8',
      isPinned INTEGER DEFAULT 0,
      createTime INTEGER NOT NULL,
      updateTime INTEGER NOT NULL,
      remindAt INTEGER,
      reminded INTEGER DEFAULT 0
    );
  `)

  // 迁移旧字段
  try { db.exec('ALTER TABLE items ADD COLUMN fileSize INTEGER') } catch {}
  try { db.exec('ALTER TABLE items ADD COLUMN imageWidth INTEGER') } catch {}
  try { db.exec('ALTER TABLE items ADD COLUMN imageHeight INTEGER') } catch {}
  try { db.exec('ALTER TABLE notes ADD COLUMN remindAt INTEGER') } catch {}
  try { db.exec('ALTER TABLE notes ADD COLUMN reminded INTEGER DEFAULT 0') } catch {}

  // v1.4 迁移框架（user_version）
  runMigrations()

  // FTS5 全文索引（trigram 支持英文子串）
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(content, ocrText, tokenize='trigram')`)
    const ftsCount = db.prepare('SELECT COUNT(*) AS c FROM items_fts').get().c
    const itemCount = db.prepare('SELECT COUNT(*) AS c FROM items').get().c
    if (ftsCount === 0 && itemCount > 0 && !encryption.isEnabled()) {
      db.exec('INSERT INTO items_fts(rowid, content, ocrText) SELECT id, content, ocrText FROM items')
    }
  } catch (err) {
    console.error('[DBService] FTS init error (search will fall back to LIKE):', err.message)
  }

  stmtFtsInsert = db.prepare('INSERT INTO items_fts(rowid, content, ocrText) VALUES (?, ?, ?)')
  stmtFtsDelete = db.prepare('DELETE FROM items_fts WHERE rowid = ?')

  registerEventHandlers()
  // 启动时自动备份上一份数据库和配置（Online Backup API，保留最近 5 份）
  await backupDatabase()
  return db
}

// ====== Save（better-sqlite3 即时落盘，无需防抖） ======
function save() {}
function saveImmediate() {}

// ====== Event Handlers ======
function registerEventHandlers() {
  eventBus.on(Events.CLIPBOARD_TEXT, (item) => {
    const result = insert(item)
    if (result) {
      eventBus.emit(Events.DB_INSERT, result)
      eventBus.emit(Events.PET_NOTIFY, result)
      // 实体识别：仅当内容可安全分析时携带明文，否则只发空任务（异步消费方标记跳过）
      const canAnalyze = result.sensitivity === 0 &&
        !result.metadataOnly &&
        !!result.content &&
        !(encryption.isEnabled() && !encryption.isUnlocked())
      eventBus.emit(Events.ENTITY_JOB, {
        itemId: result.id,
        content: canAnalyze ? result.content : null
      })
    }
  })

  eventBus.on(Events.CLIPBOARD_IMAGE, (item) => {
    const result = insert(item)
    if (result) {
      eventBus.emit(Events.DB_INSERT, result)
      eventBus.emit(Events.PET_NOTIFY, result)
      if (result.filePath) {
        eventBus.emit(Events.OCR_JOB, { filePath: result.filePath, itemId: result.id })
      }
    }
  })

  eventBus.on(Events.OCR_DONE, ({ id, text }) => {
    updateOcrText(id, text)
    const { BrowserWindow } = require('electron')
    const mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
    if (mainWindow) {
      mainWindow.webContents.send('clipboard:update', { id, ocrText: text, _ocrUpdated: true })
    }
  })
}

// ====== Items CRUD ======
function insert(item) {
  if (!db) return null
  const encContent = encryption.isEnabled() ? encryption.encrypt(item.content || '') : item.content
  const encOcr = encryption.isEnabled() ? encryption.encrypt(item.ocrText || '') : item.ocrText
  const info = db.prepare(`
    INSERT INTO items (type, content, filePath, thumbPath, ocrText, isFavorite, createTime, fileSize, imageWidth, imageHeight, sourceApp, sourceProcess, capturedAt, sensitivity, metadataOnly)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.type,
    encContent,
    item.filePath || null,
    item.thumbPath || null,
    encOcr,
    item.createTime || Date.now(),
    item.fileSize || null,
    item.imageWidth || null,
    item.imageHeight || null,
    item.sourceApp || null,
    item.sourceProcess || null,
    item.capturedAt || null,
    item.sensitivity || 0,
    item.metadataOnly || 0
  )
  const id = Number(info.lastInsertRowid)
  if (!encryption.isEnabled()) syncFtsInsert(id, item.content || '', item.ocrText || '')
  return { ...item, id, isFavorite: 0 }
}

function decryptRow(r) {
  if (!r) return r
  return { ...r, content: encryption.decrypt(r.content), ocrText: encryption.decrypt(r.ocrText) }
}

function remove(id) {
  if (!db) return null
  const item = db.prepare('SELECT filePath, thumbPath, annotatedPath FROM items WHERE id = ?').get(id)
  db.prepare('DELETE FROM items WHERE id = ?').run(id)
  db.prepare('DELETE FROM entities WHERE item_id = ?').run(id)
  db.prepare('DELETE FROM annotations WHERE item_id = ?').run(id)
  syncFtsDelete(id)
  return item || null
}

// ====== Entity 查询辅助（v1.6.0） ======

function normalizeEntityFilters(filters = []) {
  const out = []
  for (const f of filters) {
    const type = String((f && f.type) || '').trim()
    if (!ENTITY_TYPES.has(type)) continue
    const value = normalizeQuery(type, f.value)
    if (!value) continue
    out.push({ type, value })
  }
  return out
}

function entityIdSetForFilters(filters = []) {
  const normalized = normalizeEntityFilters(filters)
  if (normalized.length === 0) return null
  let set = null
  for (const f of normalized) {
    const rows = db.prepare('SELECT item_id FROM entities WHERE type = ? AND value = ?').all(f.type, f.value)
    const cur = new Set(rows.map(r => r.item_id))
    set = set ? new Set([...set].filter(id => cur.has(id))) : cur
    if (set.size === 0) break
  }
  return set
}

function idInClauseList(set, alias = '') {
  const ids = [...set]
  const prefix = alias ? alias + '.' : ''
  const groups = []
  const params = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    groups.push(`${prefix}id IN (${chunk.map(() => '?').join(',')})`)
    params.push(...chunk)
  }
  return {
    clause: groups.length ? ` AND (${groups.join(' OR ')})` : '',
    params
  }
}

function attachEntities(rows, withEntities) {
  if (!withEntities || !rows || rows.length === 0) return rows
  const map = new Map()
  const ids = rows.map(r => r.id)
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const ph = chunk.map(() => '?').join(',')
    const ents = db.prepare(`
      SELECT item_id, type, value, confidence FROM entities WHERE item_id IN (${ph})
    `).all(...chunk)
    for (const e of ents) {
      if (!map.has(e.item_id)) map.set(e.item_id, [])
      map.get(e.item_id).push({ type: e.type, value: e.value, confidence: e.confidence })
    }
  }
  for (const row of rows) {
    const list = (map.get(row.id) || []).slice()
    list.sort((a, b) => {
      const ia = ENTITY_DISPLAY_INDEX.has(a.type) ? ENTITY_DISPLAY_INDEX.get(a.type) : 99
      const ib = ENTITY_DISPLAY_INDEX.has(b.type) ? ENTITY_DISPLAY_INDEX.get(b.type) : 99
      return ia - ib
    })
    row.entities = list
  }
  return rows
}

function getAll({
  search = '',
  limit = 200,
  type = null,
  favorite = null,
  entityFilters = [],
  ids = null,
  worksiteId = null,
  withEntities = false,
  sort = 'default'
} = {}) {
  if (!db) return []
  const trimmed = String(search).trim()
  const entitySet = entityIdSetForFilters(entityFilters)
  const idArray = Array.isArray(ids)
    ? ids.map(Number).filter(Number.isInteger)
    : null
  if (idArray !== null && idArray.length === 0) return []
  const wsId = Number.isInteger(worksiteId) && worksiteId > 0 ? worksiteId : null

  // 合并 ids 与实体过滤为最终 id 集合（交集）
  let finalSet = entitySet
  if (idArray !== null) {
    const idSet = new Set(idArray)
    finalSet = finalSet ? new Set([...finalSet].filter(id => idSet.has(id))) : idSet
  }
  if (finalSet && finalSet.size === 0) return []

  const orderBy = sort === 'time' ? 'ORDER BY createTime DESC' : 'ORDER BY isFavorite DESC, createTime DESC'
  const orderByAlias = sort === 'time' ? 'ORDER BY i.createTime DESC' : 'ORDER BY i.isFavorite DESC, i.createTime DESC'

  if (encryption.isEnabled()) {
    const rows = db.prepare('SELECT * FROM items ORDER BY isFavorite DESC, createTime DESC LIMIT ?').all(Math.max(limit, 10000))
    let decrypted = rows.map(decryptRow)
    if (finalSet) decrypted = decrypted.filter(i => finalSet.has(i.id))
    if (wsId) decrypted = decrypted.filter(i => i.worksiteId === wsId)
    if (trimmed) {
      const q = trimmed.toLowerCase()
      decrypted = decrypted.filter(i =>
        (i.content || '').toLowerCase().includes(q) ||
        (i.ocrText || '').toLowerCase().includes(q)
      )
    }
    if (sort === 'time') decrypted = decrypted.slice().sort((a, b) => b.createTime - a.createTime)
    return attachEntities(decrypted.slice(0, limit), withEntities)
  }

  const extra = []
  const extraParams = []
  if (type) { extra.push('i.type = ?'); extraParams.push(type) }
  if (favorite) { extra.push('i.isFavorite = 1') }
  if (wsId) { extra.push('i.worksiteId = ?'); extraParams.push(wsId) }
  const extraSql = extra.length ? ' AND ' + extra.join(' AND ') : ''
  const extraSqlNoAlias = extra.length ? ' AND ' + extra.join(' AND ').replace(/\bi\./g, '') : ''
  const idClause = finalSet ? idInClauseList(finalSet, 'i') : null
  const idClauseNoAlias = finalSet ? idInClauseList(finalSet) : null

  if (trimmed) {
    const hasCJK = /[\u4e00-\u9fff]/.test(trimmed)
    if (!hasCJK && trimmed.length >= 3) {
      try {
        const matchQuery = buildFtsQuery(trimmed)
        const rows = db.prepare(`
          SELECT i.* FROM items i
          WHERE i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)
          ${extraSql}
          ${idClause ? idClause.clause : ''}
          ${orderByAlias}
          LIMIT ?
        `).all(matchQuery, ...extraParams, ...(idClause ? idClause.params : []), limit)
        return attachEntities(rows.map(decryptRow), withEntities)
      } catch (e) {
        console.warn('[DBService] FTS search failed, fallback LIKE:', e.message)
      }
    }

    const escaped = search.replace(/[\\%_]/g, m => '\\' + m)
    const q = `%${escaped}%`
    const rows = db.prepare(`
      SELECT * FROM items
      WHERE (content LIKE ? ESCAPE '\\' OR ocrText LIKE ? ESCAPE '\\')
      ${extraSqlNoAlias}
      ${idClauseNoAlias ? idClauseNoAlias.clause : ''}
      ${orderBy}
      LIMIT ?
    `).all(q, q, ...extraParams, ...(idClauseNoAlias ? idClauseNoAlias.params : []), limit)
    return attachEntities(rows.map(decryptRow), withEntities)
  }

  let sql = 'SELECT * FROM items'
  const whereParts = []
  if (extra.length) whereParts.push(extra.join(' AND ').replace(/\bi\./g, ''))
  if (idClauseNoAlias) whereParts.push(idClauseNoAlias.clause.replace(/^ AND /, ''))
  if (whereParts.length) {
    const where = whereParts.join(' AND ')
    sql += ' WHERE ' + where
  }
  sql += ' ' + orderBy + ' LIMIT ?'
  const rows = db.prepare(sql).all(...extraParams, ...(idClauseNoAlias ? idClauseNoAlias.params : []), limit).map(decryptRow)
  return attachEntities(rows, withEntities)
}

function toggleFavorite(id) {
  if (!db) return null
  db.prepare('UPDATE items SET isFavorite = 1 - isFavorite WHERE id = ?').run(id)
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) || null
}

function updateContent(id, content) {
  if (!db) return
  const encContent = encryption.isEnabled() ? encryption.encrypt(content) : content
  db.prepare('UPDATE items SET content = ? WHERE id = ?').run(encContent, id)
  if (!encryption.isEnabled()) syncFtsUpdate(id, content, getItemOcrText(id))
}

function updateOcrText(id, ocrText) {
  if (!db) return
  const encOcr = encryption.isEnabled() ? encryption.encrypt(ocrText || '') : ocrText
  db.prepare('UPDATE items SET ocrText = ? WHERE id = ?').run(encOcr, id)
  if (!encryption.isEnabled()) syncFtsUpdate(id, getItemContent(id), ocrText)
}

function clearNonFavorites() {
  if (!db) return
  const rows = db.prepare('SELECT id, filePath, thumbPath, annotatedPath FROM items WHERE isFavorite = 0 AND worksiteId IS NULL').all()
  db.prepare('DELETE FROM items WHERE isFavorite = 0 AND worksiteId IS NULL').run()

  const ids = rows.map(r => r.id)
  deleteEntitiesForIds(ids)
  deleteAnnotationsForIds(ids)
  for (const id of ids) syncFtsDelete(id)
  if (ids.length > 0) eventBus.emit(Events.DB_BATCH_DELETE, { ids })

  for (const row of rows) {
    const unlink = (p, kind) => {
      if (!p) return
      try { fs.unlinkSync(p) } catch (e) {
        console.error('[UnlinkFail]', JSON.stringify({ itemId: row.id, kind, path: p, error: e.message }))
      }
    }
    unlink(row.filePath, 'full')
    unlink(row.thumbPath, 'thumb')
    unlink(row.annotatedPath, 'annotated')
  }
}

function cleanOld(maxItems = 2000) {
  return cleanByPolicy({ enabled: true, maxItems, maxDays: 0, maxImageItems: 0 })
}

/**
 * 可配置 retention 清理
 *
 * policy（已归一化，见 services/retention.js）：
 *   enabled         - false 时完全关闭自动清理
 *   maxItems        - 最大总记录数（0 = 不限制）；超过后删除最旧的未收藏记录
 *   maxDays         - 按天数清理（0 = 不启用）；超过天数的未收藏记录会被删除
 *   maxImageItems   - 图片独立保留上限（0 = 不限制）；仅作用于未收藏图片
 *
 * 规则：
 *   - 收藏内容永不自动删除
 *   - 达到上限时优先删除最旧的未收藏记录
 *   - 返回被删行（含 filePath/thumbPath），由调用方负责删除文件
 */
function collectCleanCandidates(policy = {}) {
  if (!db) return { rows: [], ids: [] }
  const num = (v, dflt) => Number.isFinite(v) ? Math.max(0, Math.floor(v)) : dflt
  const maxItems = num(policy.maxItems, 0)
  const maxDays = num(policy.maxDays, 0)
  const maxImageItems = num(policy.maxImageItems, 0)

  const candidates = new Map() // id -> row
  const now = Date.now()

  // 按天数：删除超过 maxDays 的未收藏记录
  if (maxDays > 0) {
    const cutoff = now - maxDays * 24 * 60 * 60 * 1000
    for (const r of db.prepare(`
      SELECT id, type, filePath, thumbPath, annotatedPath FROM items
      WHERE isFavorite = 0 AND worksiteId IS NULL AND createTime < ?
    `).all(cutoff)) {
      candidates.set(r.id, r)
    }
  }

  // 按总条数：超过 maxItems 后删最旧未收藏
  if (maxItems > 0) {
    const count = db.prepare('SELECT COUNT(*) AS c FROM items').get().c
    const toDelete = count - maxItems
    if (toDelete > 0) {
      for (const r of db.prepare(`
        SELECT id, type, filePath, thumbPath, annotatedPath FROM items
        WHERE isFavorite = 0 AND worksiteId IS NULL
        ORDER BY createTime ASC
        LIMIT ?
      `).all(toDelete)) {
        candidates.set(r.id, r)
      }
    }
  }

  // 图片独立上限：仅未收藏图片
  if (maxImageItems > 0) {
    const imageCount = db.prepare(`
      SELECT COUNT(*) AS c FROM items WHERE type = 'image' AND isFavorite = 0
    `).get().c
    const toDelete = imageCount - maxImageItems
    if (toDelete > 0) {
      for (const r of db.prepare(`
        SELECT id, type, filePath, thumbPath, annotatedPath FROM items
        WHERE type = 'image' AND isFavorite = 0 AND worksiteId IS NULL
        ORDER BY createTime ASC
        LIMIT ?
      `).all(toDelete)) {
        candidates.set(r.id, r)
      }
    }
  }
  return { rows: [...candidates.values()], ids: [...candidates.keys()] }
}

function cleanByPolicy(policy = {}) {
  if (!db || policy.enabled === false) return []
  const { rows, ids } = collectCleanCandidates(policy)
  if (rows.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM items WHERE id IN (${placeholders})`).run(...ids)
  deleteEntitiesForIds(ids)
  deleteAnnotationsForIds(ids)
  for (const id of ids) syncFtsDelete(id)
  eventBus.emit(Events.DB_BATCH_DELETE, { ids })
  return rows
}

function peekCleanByPolicy(policy = {}) {
  if (!db || policy.enabled === false) {
    return { itemCount: 0, imageCount: 0, annotationCount: 0, bytesFreed: 0, rows: [] }
  }
  const { rows, ids } = collectCleanCandidates(policy)
  let bytes = 0
  for (const r of rows) {
    for (const p of [r.filePath, r.thumbPath, r.annotatedPath]) {
      if (p && fs.existsSync(p)) bytes += fs.statSync(p).size
    }
  }
  let annotationCount = 0
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const ph = chunk.map(() => '?').join(',')
    annotationCount += db.prepare(`SELECT COUNT(*) c FROM annotations WHERE item_id IN (${ph})`).get(...chunk).c
  }
  return {
    itemCount: rows.length,
    imageCount: rows.filter(r => r.type === 'image').length,
    annotationCount,
    bytesFreed: bytes,
    rows
  }
}

// ====== Entities（v1.5.0 本地实体识别持久化） ======

function deleteEntitiesForIds(ids) {
  if (!db || !Array.isArray(ids) || ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM entities WHERE item_id IN (${placeholders})`).run(...ids)
}

function insertEntities(itemId, entities = []) {
  if (!db || !itemId) return
  const list = entities.filter(e => e && e.type && e.value)
  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO entities (item_id, type, value, confidence, match_type, createTime)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const tx = db.transaction((rows) => {
    for (const e of rows) {
      stmt.run(itemId, e.type, e.value, e.confidence, e.match_type, now)
    }
  })
  tx(list)
  markEntityState(itemId, 1)
}

function markEntityState(id, state) {
  if (!db || !id) return
  db.prepare('UPDATE items SET entityState = ? WHERE id = ?').run(state, id)
}

function getEntitiesByItem(itemId) {
  if (!db) return []
  return db.prepare('SELECT * FROM entities WHERE item_id = ? ORDER BY id').all(itemId)
}

// ====== Notes CRUD ======
function getAllNotes() {
  if (!db) return []
  return db.prepare('SELECT * FROM notes ORDER BY isPinned DESC, updateTime DESC').all().map(n => ({
    ...n,
    title: encryption.decrypt(n.title),
    content: encryption.decrypt(n.content)
  }))
}

function insertNote(note) {
  if (!db) return null
  const now = Date.now()
  const encTitle = encryption.isEnabled() ? encryption.encrypt(note.title || '') : note.title || ''
  const encContent = encryption.isEnabled() ? encryption.encrypt(note.content || '') : note.content || ''
  const info = db.prepare(`
    INSERT INTO notes (title, content, color, isPinned, createTime, updateTime, remindAt, reminded)
    VALUES (?, ?, ?, 0, ?, ?, ?, 0)
  `).run(encTitle, encContent, note.color || '#f5f0a8', now, now, note.remindAt || null)
  return {
    id: Number(info.lastInsertRowid),
    title: note.title || '',
    content: note.content || '',
    color: note.color || '#f5f0a8',
    isPinned: 0,
    createTime: now,
    updateTime: now,
    remindAt: note.remindAt || null,
    reminded: 0
  }
}

function updateNote(id, changes) {
  if (!db || !changes) return
  const sets = []
  const vals = []
  if (changes.title !== undefined) { sets.push('title = ?'); vals.push(encryption.isEnabled() ? encryption.encrypt(changes.title) : changes.title) }
  if (changes.content !== undefined) { sets.push('content = ?'); vals.push(encryption.isEnabled() ? encryption.encrypt(changes.content) : changes.content) }
  if (changes.color !== undefined) { sets.push('color = ?'); vals.push(changes.color) }
  if (changes.isPinned !== undefined) { sets.push('isPinned = ?'); vals.push(changes.isPinned) }
  if (changes.remindAt !== undefined) { sets.push('remindAt = ?'); vals.push(changes.remindAt) }
  if (changes.reminded !== undefined) { sets.push('reminded = ?'); vals.push(changes.reminded) }
  sets.push('updateTime = ?')
  vals.push(Date.now())
  vals.push(id)
  db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

function deleteNote(id) {
  if (!db) return
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
}

function toggleNotePin(id) {
  if (!db) return null
  db.prepare('UPDATE notes SET isPinned = 1 - isPinned WHERE id = ?').run(id)
  return true
}

function getDueReminders(now) {
  if (!db) return []
  return db.prepare('SELECT * FROM notes WHERE remindAt IS NOT NULL AND reminded = 0 AND remindAt <= ?').all(now).map(n => ({
    ...n,
    title: encryption.decrypt(n.title),
    content: encryption.decrypt(n.content)
  }))
}

function markNoteReminded(id) {
  if (!db) return
  db.prepare('UPDATE notes SET reminded = 1 WHERE id = ?').run(id)
}

// ====== Worksite CRUD（v1.7.0）======
function getWorksite(id) {
  if (!db || !Number.isInteger(id)) return null
  const row = db.prepare(`
    SELECT w.*, COUNT(i.id) AS itemCount, MAX(i.createTime) AS lastItemTime
    FROM worksites w LEFT JOIN items i ON i.worksiteId = w.id
    WHERE w.id = ? GROUP BY w.id
  `).get(id)
  if (!row) return null
  return {
    ...row,
    title: encryption.decrypt(row.title),
    note: encryption.decrypt(row.note),
    itemCount: Number(row.itemCount || 0)
  }
}

function createWorksite({ title, note } = {}) {
  if (!db) return null
  const t = String(title || '').trim()
  if (!t) return null
  const now = Date.now()
  const encTitle = encryption.isEnabled() ? encryption.encrypt(t) : t
  const encNote = encryption.isEnabled() ? encryption.encrypt(String(note || '')) : String(note || '')
  const info = db.prepare(`
    INSERT INTO worksites (title, note, archived, createTime, updateTime)
    VALUES (?, ?, 0, ?, ?)
  `).run(encTitle, encNote, now, now)
  return getWorksite(Number(info.lastInsertRowid))
}

function listWorksites() {
  if (!db) return []
  const rows = db.prepare(`
    SELECT w.*, COUNT(i.id) AS itemCount, MAX(i.createTime) AS lastItemTime
    FROM worksites w LEFT JOIN items i ON i.worksiteId = w.id
    GROUP BY w.id
    ORDER BY w.archived ASC, w.updateTime DESC
  `).all()
  return rows.map(r => ({
    ...r,
    title: encryption.decrypt(r.title),
    note: encryption.decrypt(r.note),
    itemCount: Number(r.itemCount || 0)
  }))
}

function updateWorksite(id, changes = {}) {
  if (!db || !Number.isInteger(id)) return null
  const sets = []
  const vals = []
  if (changes.title !== undefined) {
    const t = String(changes.title).trim()
    if (!t) return null
    sets.push('title = ?')
    vals.push(encryption.isEnabled() ? encryption.encrypt(t) : t)
  }
  if (changes.note !== undefined) {
    sets.push('note = ?')
    vals.push(encryption.isEnabled() ? encryption.encrypt(String(changes.note)) : String(changes.note))
  }
  if (changes.archived !== undefined) {
    sets.push('archived = ?')
    vals.push(changes.archived ? 1 : 0)
  }
  if (sets.length === 0) return getWorksite(id)
  sets.push('updateTime = ?')
  vals.push(Date.now(), id)
  db.prepare(`UPDATE worksites SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getWorksite(id)
}

function deleteWorksite(id) {
  if (!db || !Number.isInteger(id)) return false
  const tx = db.transaction(() => {
    db.prepare('UPDATE items SET worksiteId = NULL WHERE worksiteId = ?').run(id)
    const info = db.prepare('DELETE FROM worksites WHERE id = ?').run(id)
    return info.changes > 0
  })
  return tx()
}

function touchWorksites(ids) {
  const uniq = [...new Set((ids || []).filter(Number.isInteger))]
  if (uniq.length === 0) return
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500)
    db.prepare(`UPDATE worksites SET updateTime = ? WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .run(Date.now(), ...chunk)
  }
}

function setItemsWorksite(ids, worksiteId) {
  if (!db || !Array.isArray(ids) || ids.length === 0) return { ok: false, error: '空选择' }
  const itemIds = ids.map(Number).filter(Number.isInteger)
  if (itemIds.length === 0) return { ok: false, error: '无效记录' }
  const target = Number.isInteger(worksiteId) && worksiteId > 0 ? worksiteId : null
  if (target !== null) {
    const exists = db.prepare('SELECT id FROM worksites WHERE id = ?').get(target)
    if (!exists) return { ok: false, error: '现场不存在' }
  }
  const tx = db.transaction(() => {
    const touched = new Set()
    for (let i = 0; i < itemIds.length; i += 500) {
      const chunk = itemIds.slice(i, i + 500)
      const ph = chunk.map(() => '?').join(',')
      const oldRows = db.prepare(`SELECT DISTINCT worksiteId FROM items WHERE id IN (${ph}) AND worksiteId IS NOT NULL`).all(...chunk)
      for (const r of oldRows) if (Number.isInteger(r.worksiteId)) touched.add(r.worksiteId)
      if (target !== null) touched.add(target)
      db.prepare(`UPDATE items SET worksiteId = ? WHERE id IN (${ph})`).run(target, ...chunk)
    }
    touchWorksites([...touched])
  })
  tx()
  return { ok: true, updated: itemIds.length }
}

// ====== Image Annotation（v1.8.0）======
function deleteAnnotationsForIds(ids) {
  if (!db || !Array.isArray(ids) || ids.length === 0) return
  const ints = ids.map(Number).filter(Number.isInteger)
  for (let i = 0; i < ints.length; i += 500) {
    const chunk = ints.slice(i, i + 500)
    db.prepare(`DELETE FROM annotations WHERE item_id IN (${chunk.map(() => '?').join(',')})`).run(...chunk)
  }
}

function getAnnotations(itemId) {
  if (!db || !Number.isInteger(itemId)) return []
  return db.prepare('SELECT * FROM annotations WHERE item_id = ? ORDER BY id').all(itemId).map(r => {
    let el = null
    try { el = JSON.parse(encryption.decrypt(r.data)) } catch { el = null }
    return el && typeof el === 'object' ? { ...el, kind: r.kind } : null
  }).filter(Boolean)
}

/**
 * 替换非马赛克标注元素；已烧录的 mosaic 行（flattened）保留。
 * 新增元素中若含 mosaic，同样以 flattened 语义插入。
 */
function replaceAnnotations(itemId, elements) {
  if (!db || !Number.isInteger(itemId)) return { ok: false, error: '无效记录' }
  const list = Array.isArray(elements) ? elements.filter(e => e && typeof e === 'object') : []
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM annotations WHERE item_id = ? AND kind != 'mosaic'`).run(itemId)
    const now = Date.now()
    const ins = db.prepare('INSERT INTO annotations (item_id, kind, data, createTime) VALUES (?, ?, ?, ?)')
    for (const el of list) {
      const kind = String(el.kind || '')
      if (!kind) continue
      const payload = { ...el, kind: undefined, flattened: kind === 'mosaic' ? true : !!el.flattened }
      const data = encryption.isEnabled()
        ? encryption.encrypt(JSON.stringify(payload))
        : JSON.stringify(payload)
      ins.run(itemId, kind, data, now)
    }
  })
  tx()
  return { ok: true, count: list.length }
}

function setItemAnnotatedPath(itemId, annotatedPath) {
  if (!db || !Number.isInteger(itemId)) return false
  db.prepare('UPDATE items SET annotatedPath = ? WHERE id = ?').run(annotatedPath || null, itemId)
  return true
}

// ====== Known Missing Image Assets（v1.9.1）======
function confirmAssetMissing(ids, note = '') {
  if (!db || !Array.isArray(ids)) return { ok: false, error: 'invalid ids' }
  const ints = [...new Set(ids.map(Number).filter(Number.isInteger))]
  if (ints.length === 0) return { ok: false, error: 'no valid ids' }
  const noteStr = String(note == null ? '' : note).slice(0, 200)
  const audit = db.transaction((list) => {
    const now = Date.now()
    const upd = db.prepare("UPDATE items SET assetState = 'missing', assetMissingAt = ?, assetMissingNote = ? WHERE id = ? AND type = 'image' AND filePath IS NOT NULL")
    const out = []
    for (const id of list) {
      const row = db.prepare('SELECT assetState FROM items WHERE id = ?').get(id)
      if (!row) continue
      const info = upd.run(now, noteStr, id)
      if (info.changes > 0) out.push({ itemId: id, oldState: row.assetState, newState: 'missing' })
    }
    return out
  })(ints)
  return { ok: true, updated: audit }
}

function revokeAssetMissing(ids) {
  if (!db || !Array.isArray(ids)) return { ok: false, error: 'invalid ids' }
  const ints = [...new Set(ids.map(Number).filter(Number.isInteger))]
  if (ints.length === 0) return { ok: false, error: 'no valid ids' }
  const audit = db.transaction((list) => {
    const upd = db.prepare("UPDATE items SET assetState = 'ok', assetMissingAt = NULL, assetMissingNote = '' WHERE id = ?")
    const out = []
    for (const id of list) {
      const row = db.prepare('SELECT assetState FROM items WHERE id = ?').get(id)
      if (!row) continue
      const info = upd.run(id)
      if (info.changes > 0) out.push({ itemId: id, oldState: row.assetState, newState: 'ok' })
    }
    return out
  })(ints)
  return { ok: true, updated: audit }
}

// ====== Close ======
function close() {
  if (db) {
    try { db.close() } catch {}
    db = null
  }
}

// ====== 加密迁移 ======
function clearFts() {
  if (!db) return
  try { db.prepare('DELETE FROM items_fts').run() } catch {}
}

function reEncryptAll() {
  if (!db || !encryption.isUnlocked()) return
  const rows = db.prepare('SELECT id, content, ocrText FROM items').all()
  const upd = db.prepare('UPDATE items SET content = ?, ocrText = ? WHERE id = ?')
  for (const r of rows) {
    upd.run(encryption.encrypt(r.content), encryption.encrypt(r.ocrText), r.id)
  }
  const notes = db.prepare('SELECT id, title, content FROM notes').all()
  const updNote = db.prepare('UPDATE notes SET title = ?, content = ? WHERE id = ?')
  for (const n of notes) {
    updNote.run(encryption.encrypt(n.title), encryption.encrypt(n.content), n.id)
  }
  clearFts()
}

function decryptAllAndRebuildFts() {
  if (!db) return
  const rows = db.prepare('SELECT id, content, ocrText FROM items').all()
  const upd = db.prepare('UPDATE items SET content = ?, ocrText = ? WHERE id = ?')
  for (const r of rows) {
    upd.run(encryption.decrypt(r.content), encryption.decrypt(r.ocrText), r.id)
  }
  const notes = db.prepare('SELECT id, title, content FROM notes').all()
  const updNote = db.prepare('UPDATE notes SET title = ?, content = ? WHERE id = ?')
  for (const n of notes) {
    updNote.run(encryption.decrypt(n.title), encryption.decrypt(n.content), n.id)
  }
  clearFts()
  const itemCount = db.prepare('SELECT COUNT(*) AS c FROM items').get().c
  if (itemCount > 0) {
    try { db.exec('INSERT INTO items_fts(rowid, content, ocrText) SELECT id, content, ocrText FROM items') } catch {}
  }
}

module.exports = {
  init, getAll, insert, remove, toggleFavorite, updateContent, updateOcrText,
  clearNonFavorites, cleanOld, cleanByPolicy, collectCleanCandidates, peekCleanByPolicy,
  backupTo, close, save, saveImmediate,
  insertEntities, markEntityState, getEntitiesByItem, deleteEntitiesForIds,
  getAllNotes, insertNote, updateNote, deleteNote, toggleNotePin,
  getDueReminders, markNoteReminded,
  getWorksite, createWorksite, listWorksites, updateWorksite, deleteWorksite,
  setItemsWorksite,
  getItem, getAnnotations, replaceAnnotations, setItemAnnotatedPath, deleteAnnotationsForIds,
  confirmAssetMissing, revokeAssetMissing,
  clearFts, reEncryptAll, decryptAllAndRebuildFts,
  MIGRATIONS
}

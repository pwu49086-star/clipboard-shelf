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
const { app } = require('electron')
const { eventBus, Events } = require('../core/event-bus')

// ====== State ======
let db = null
let dbPath = null

function userDataDir() {
  return process.env.CLIPBOARD_SHELF_USER_DATA || app.getPath('userData')
}

// ====== Backup ======
function backupDatabase() {
  try {
    if (!dbPath || !fs.existsSync(dbPath)) return
    const backupDir = path.join(userDataDir(), 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    fs.copyFileSync(dbPath, path.join(backupDir, `shelf-${ts}.db`))
    const cfgSrc = path.join(userDataDir(), 'config.json')
    if (fs.existsSync(cfgSrc)) {
      fs.copyFileSync(cfgSrc, path.join(backupDir, `config-${ts}.json`))
    }
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('shelf-') && f.endsWith('.db'))
      .sort()
    while (backups.length > 5) {
      fs.unlinkSync(path.join(backupDir, backups.shift()))
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

function buildFtsQuery(search) {
  return search.split(/\s+/).filter(Boolean).map(t => '"' + t.replace(/"/g, '""') + '"').join(' ')
}

// ====== Init ======
async function init() {
  const userData = userDataDir()
  fs.mkdirSync(userData, { recursive: true })
  dbPath = path.join(userData, 'shelf.db')

  // 启动时自动备份上一份数据库和配置（保留最近 5 份）
  backupDatabase()

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
      imageHeight INTEGER
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

  // FTS5 全文索引（trigram 支持英文子串）
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(content, ocrText, tokenize='trigram')`)
    const ftsCount = db.prepare('SELECT COUNT(*) AS c FROM items_fts').get().c
    const itemCount = db.prepare('SELECT COUNT(*) AS c FROM items').get().c
    if (ftsCount === 0 && itemCount > 0) {
      db.exec('INSERT INTO items_fts(rowid, content, ocrText) SELECT id, content, ocrText FROM items')
    }
  } catch (err) {
    console.error('[DBService] FTS init error (search will fall back to LIKE):', err.message)
  }

  stmtFtsInsert = db.prepare('INSERT INTO items_fts(rowid, content, ocrText) VALUES (?, ?, ?)')
  stmtFtsDelete = db.prepare('DELETE FROM items_fts WHERE rowid = ?')

  registerEventHandlers()
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
  const info = db.prepare(`
    INSERT INTO items (type, content, filePath, thumbPath, ocrText, isFavorite, createTime, fileSize, imageWidth, imageHeight)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    item.type,
    item.content,
    item.filePath || null,
    item.thumbPath || null,
    item.ocrText || null,
    item.createTime || Date.now(),
    item.fileSize || null,
    item.imageWidth || null,
    item.imageHeight || null
  )
  const id = Number(info.lastInsertRowid)
  syncFtsInsert(id, item.content || '', item.ocrText || '')
  return { ...item, id, isFavorite: 0 }
}

function remove(id) {
  if (!db) return null
  const item = db.prepare('SELECT filePath, thumbPath FROM items WHERE id = ?').get(id)
  db.prepare('DELETE FROM items WHERE id = ?').run(id)
  syncFtsDelete(id)
  return item || null
}

function getAll({ search = '', limit = 200 } = {}) {
  if (!db) return []
  const trimmed = String(search).trim()

  if (trimmed) {
    const hasCJK = /[\u4e00-\u9fff]/.test(trimmed)
    if (!hasCJK && trimmed.length >= 3) {
      try {
        const matchQuery = buildFtsQuery(trimmed)
        const rows = db.prepare(`
          SELECT i.* FROM items i
          WHERE i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)
          ORDER BY i.isFavorite DESC, i.createTime DESC
          LIMIT ?
        `).all(matchQuery, limit)
        return rows
      } catch (e) {
        console.warn('[DBService] FTS search failed, fallback LIKE:', e.message)
      }
    }

    const escaped = search.replace(/[\\%_]/g, m => '\\' + m)
    const q = `%${escaped}%`
    return db.prepare(`
      SELECT * FROM items
      WHERE content LIKE ? ESCAPE '\\' OR ocrText LIKE ? ESCAPE '\\'
      ORDER BY isFavorite DESC, createTime DESC
      LIMIT ?
    `).all(q, q, limit)
  }

  return db.prepare('SELECT * FROM items ORDER BY isFavorite DESC, createTime DESC LIMIT ?').all(limit)
}

function toggleFavorite(id) {
  if (!db) return null
  db.prepare('UPDATE items SET isFavorite = 1 - isFavorite WHERE id = ?').run(id)
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) || null
}

function updateContent(id, content) {
  if (!db) return
  db.prepare('UPDATE items SET content = ? WHERE id = ?').run(content, id)
  syncFtsUpdate(id, content, getItemOcrText(id))
}

function updateOcrText(id, ocrText) {
  if (!db) return
  db.prepare('UPDATE items SET ocrText = ? WHERE id = ?').run(ocrText, id)
  syncFtsUpdate(id, getItemContent(id), ocrText)
}

function clearNonFavorites() {
  if (!db) return
  const rows = db.prepare('SELECT id, filePath, thumbPath FROM items WHERE isFavorite = 0').all()
  db.prepare('DELETE FROM items WHERE isFavorite = 0').run()

  const ids = rows.map(r => r.id)
  for (const id of ids) syncFtsDelete(id)
  if (ids.length > 0) eventBus.emit(Events.DB_BATCH_DELETE, { ids })

  for (const row of rows) {
    if (row.filePath) try { fs.unlinkSync(row.filePath) } catch {}
    if (row.thumbPath) try { fs.unlinkSync(row.thumbPath) } catch {}
  }
}

function cleanOld(maxItems = 2000) {
  if (!db) return []
  const count = db.prepare('SELECT COUNT(*) AS c FROM items').get().c
  if (count <= maxItems) return []

  const toDelete = count - maxItems
  const rows = db.prepare(`
    SELECT id, filePath, thumbPath FROM items
    WHERE isFavorite = 0
    ORDER BY createTime ASC
    LIMIT ?
  `).all(toDelete)

  const ids = rows.map(r => r.id)
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM items WHERE id IN (${placeholders})`).run(...ids)
    for (const id of ids) syncFtsDelete(id)
    eventBus.emit(Events.DB_BATCH_DELETE, { ids })
  }
  return rows
}

// ====== Notes CRUD ======
function getAllNotes() {
  if (!db) return []
  return db.prepare('SELECT * FROM notes ORDER BY isPinned DESC, updateTime DESC').all()
}

function insertNote(note) {
  if (!db) return null
  const now = Date.now()
  const info = db.prepare(`
    INSERT INTO notes (title, content, color, isPinned, createTime, updateTime, remindAt, reminded)
    VALUES (?, ?, ?, 0, ?, ?, ?, 0)
  `).run(note.title || '', note.content || '', note.color || '#f5f0a8', now, now, note.remindAt || null)
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
  if (changes.title !== undefined) { sets.push('title = ?'); vals.push(changes.title) }
  if (changes.content !== undefined) { sets.push('content = ?'); vals.push(changes.content) }
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
  return db.prepare('SELECT * FROM notes WHERE remindAt IS NOT NULL AND reminded = 0 AND remindAt <= ?').all(now)
}

function markNoteReminded(id) {
  if (!db) return
  db.prepare('UPDATE notes SET reminded = 1 WHERE id = ?').run(id)
}

// ====== Close ======
function close() {
  if (db) {
    try { db.close() } catch {}
    db = null
  }
}

module.exports = {
  init, getAll, insert, remove, toggleFavorite, updateContent, updateOcrText,
  clearNonFavorites, cleanOld, close, save, saveImmediate,
  getAllNotes, insertNote, updateNote, deleteNote, toggleNotePin,
  getDueReminders, markNoteReminded
}

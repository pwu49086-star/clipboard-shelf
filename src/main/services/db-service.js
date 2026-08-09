/**
 * DB Service - 数据库服务（事件驱动）
 *
 * 监听 EventBus 事件，不再被直接调用
 * 写盘防抖 + 安全退出
 */

const initSqlJs = require('sql.js')
const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const { eventBus, Events } = require('../core/event-bus')

// ====== State ======
let db = null
let dbPath = null
let saveTimer = null
const SAVE_DEBOUNCE = 1000 // 1s 防抖（从 500ms 增加）

// ====== Init ======
function backupDatabase() {
  try {
    if (!dbPath || !fs.existsSync(dbPath)) return
    const userData = process.env.CLIPBOARD_SHELF_USER_DATA || app.getPath('userData')
    const backupDir = path.join(userData, 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    fs.copyFileSync(dbPath, path.join(backupDir, `shelf-${ts}.db`))
    const cfgSrc = path.join(userData, 'config.json')
    if (fs.existsSync(cfgSrc)) {
      fs.copyFileSync(cfgSrc, path.join(backupDir, `config-${ts}.json`))
    }
    // 只保留最近 5 份数据库备份
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

async function init() {
  const SQL = await initSqlJs()
  const userData = process.env.CLIPBOARD_SHELF_USER_DATA || app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  dbPath = path.join(userData, 'shelf.db')

  // 启动时自动备份上一份数据库和配置（保留最近 5 份）
  backupDatabase()

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
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
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_items_favorite ON items(isFavorite)')
  db.run('CREATE INDEX IF NOT EXISTS idx_items_time ON items(createTime DESC)')

  // 迁移
  try { db.run('ALTER TABLE items ADD COLUMN fileSize INTEGER') } catch {}
  try { db.run('ALTER TABLE items ADD COLUMN imageWidth INTEGER') } catch {}
  try { db.run('ALTER TABLE items ADD COLUMN imageHeight INTEGER') } catch {}

  // 便签表
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      color TEXT DEFAULT '#f5f0a8',
      isPinned INTEGER DEFAULT 0,
      createTime INTEGER NOT NULL,
      updateTime INTEGER NOT NULL
    )
  `)
  try { db.run('ALTER TABLE notes ADD COLUMN remindAt INTEGER') } catch {}
  try { db.run('ALTER TABLE notes ADD COLUMN reminded INTEGER DEFAULT 0') } catch {}

  saveImmediate()
  registerEventHandlers()
  return db
}

// ====== Save ======
function save() {
  if (!db || !dbPath) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const data = db.export()
      const tmpPath = dbPath + '.tmp'
      fs.writeFileSync(tmpPath, Buffer.from(data))
      fs.renameSync(tmpPath, dbPath)
    } catch (err) {
      console.error('[DBService] Save error:', err)
    }
  }, SAVE_DEBOUNCE)
}

function saveImmediate() {
  if (!db || !dbPath) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  try {
    const data = db.export()
    const tmpPath = dbPath + '.tmp'
    fs.writeFileSync(tmpPath, Buffer.from(data))
    fs.renameSync(tmpPath, dbPath)
  } catch (err) {
    console.error('[DBService] SaveImmediate error:', err)
  }
}

// ====== Event Handlers ======
function registerEventHandlers() {
  // 监听剪贴板文字
  eventBus.on(Events.CLIPBOARD_TEXT, (item) => {
    const result = insert(item)
    if (result) {
      eventBus.emit(Events.DB_INSERT, result)
      eventBus.emit(Events.PET_NOTIFY, result)
    }
  })

  // 监听剪贴板图片
  eventBus.on(Events.CLIPBOARD_IMAGE, (item) => {
    const result = insert(item)
    if (result) {
      eventBus.emit(Events.DB_INSERT, result)
      eventBus.emit(Events.PET_NOTIFY, result)
      // 触发 OCR（携带 itemId）
      if (result.filePath) {
        eventBus.emit(Events.OCR_JOB, { filePath: result.filePath, itemId: result.id })
      }
    }
  })

  // 监听 OCR 结果
  eventBus.on(Events.OCR_DONE, ({ id, text }) => {
    updateOcrText(id, text)
    // 通知 renderer OCR 文本已更新
    const { BrowserWindow } = require('electron')
    const mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
    if (mainWindow) {
      mainWindow.webContents.send('clipboard:update', { id, ocrText: text, _ocrUpdated: true })
    }
  })

  // 注意：收藏事件由 ipc-handlers 直接调用 db.toggleFavorite()，不再监听 DB_FAVORITE 避免双重翻转
}

// ====== CRUD ======
function insert(item) {
  if (!db) return null
  db.run(`
    INSERT INTO items (type, content, filePath, thumbPath, ocrText, isFavorite, createTime, fileSize, imageWidth, imageHeight)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `, [item.type, item.content, item.filePath || null, item.thumbPath || null, item.ocrText || null, item.createTime || Date.now(), item.fileSize || null, item.imageWidth || null, item.imageHeight || null])

  const result = db.exec('SELECT last_insert_rowid()')
  const id = result[0] ? result[0].values[0][0] : null
  if (id === null) {
    console.error('[DBService] Insert failed: no last_insert_rowid')
    return null
  }
  save()
  return { ...item, id, isFavorite: 0 }
}

function remove(id) {
  if (!db) return null
  const stmt = db.prepare('SELECT filePath, thumbPath FROM items WHERE id = ?')
  stmt.bind([id])
  let item = null
  if (stmt.step()) item = stmt.getAsObject()
  stmt.free()

  db.run('DELETE FROM items WHERE id = ?', [id])
  save()
  return item
}

function getAll({ search = '', limit = 200 } = {}) {
  if (!db) return []
  let results

  if (search) {
    const escaped = search.replace(/%/g, '\\%').replace(/_/g, '\\_')
    const q = `%${escaped}%`
    const stmt = db.prepare(`
      SELECT * FROM items
      WHERE content LIKE ? ESCAPE '\\' OR ocrText LIKE ? ESCAPE '\\'
      ORDER BY isFavorite DESC, createTime DESC
      LIMIT ?
    `)
    stmt.bind([q, q, limit])
    results = []
    while (stmt.step()) results.push(stmt.getAsObject())
    stmt.free()
  } else {
    const stmt = db.prepare(`
      SELECT * FROM items
      ORDER BY isFavorite DESC, createTime DESC
      LIMIT ?
    `)
    stmt.bind([limit])
    results = []
    while (stmt.step()) results.push(stmt.getAsObject())
    stmt.free()
  }

  return results
}

function toggleFavorite(id) {
  if (!db) return null
  db.run('UPDATE items SET isFavorite = 1 - isFavorite WHERE id = ?', [id])
  save()

  const stmt = db.prepare('SELECT * FROM items WHERE id = ?')
  stmt.bind([id])
  let result = null
  if (stmt.step()) result = stmt.getAsObject()
  stmt.free()
  return result
}

function updateContent(id, content) {
  if (!db) return
  db.run('UPDATE items SET content = ? WHERE id = ?', [content, id])
  save()
}

function updateOcrText(id, ocrText) {
  if (!db) return
  db.run('UPDATE items SET ocrText = ? WHERE id = ?', [ocrText, id])
  save()
}

function clearNonFavorites() {
  if (!db) return
  // 先查出所有非收藏项
  const stmt = db.prepare('SELECT id, filePath, thumbPath FROM items WHERE isFavorite = 0')
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()

  db.run('DELETE FROM items WHERE isFavorite = 0')
  save()

  // 批量通知 memory-store 清理索引
  const ids = rows.map(r => r.id)
  if (ids.length > 0) {
    eventBus.emit(Events.DB_BATCH_DELETE, { ids })
  }

  // 清理文件
  for (const row of rows) {
    if (row.filePath) try { fs.unlinkSync(row.filePath) } catch {}
    if (row.thumbPath) try { fs.unlinkSync(row.thumbPath) } catch {}
  }
}

function cleanOld(maxItems = 2000) {
  if (!db) return []
  const countResult = db.exec('SELECT COUNT(*) FROM items')
  const count = countResult[0] ? countResult[0].values[0][0] : 0
  if (count <= maxItems) return []

  const toDelete = count - maxItems
  const stmt = db.prepare(`
    SELECT id, filePath, thumbPath FROM items
    WHERE isFavorite = 0
    ORDER BY createTime ASC
    LIMIT ?
  `)
  stmt.bind([toDelete])
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()

  // 批量删除
  const ids = rows.map(r => r.id)
  if (ids.length > 0) {
    db.run(`DELETE FROM items WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    save()
  }

  // 批量通知 memory-store 清理索引（使用单次事件减少开销）
  if (ids.length > 0) {
    eventBus.emit(Events.DB_BATCH_DELETE, { ids })
  }

  return rows
}

// ====== Notes ======
function getAllNotes() {
  if (!db) return []
  const stmt = db.prepare('SELECT * FROM notes ORDER BY isPinned DESC, updateTime DESC')
  const results = []
  while (stmt.step()) results.push(stmt.getAsObject())
  stmt.free()
  return results
}

function insertNote(note) {
  if (!db) return null
  const now = Date.now()
  db.run(
    'INSERT INTO notes (title, content, color, isPinned, createTime, updateTime, remindAt, reminded) VALUES (?, ?, ?, 0, ?, ?, ?, 0)',
    [note.title || '', note.content || '', note.color || '#f5f0a8', now, now, note.remindAt || null]
  )
  const result = db.exec('SELECT last_insert_rowid()')
  const id = result[0] ? result[0].values[0][0] : null
  save()
  return { id, title: note.title, content: note.content, color: note.color, isPinned: 0, createTime: now, updateTime: now, remindAt: note.remindAt || null, reminded: 0 }
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
  db.run(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`, vals)
  save()
}

function deleteNote(id) {
  if (!db) return
  db.run('DELETE FROM notes WHERE id = ?', [id])
  save()
}

function toggleNotePin(id) {
  if (!db) return null
  db.run('UPDATE notes SET isPinned = 1 - isPinned WHERE id = ?', [id])
  save()
  return true
}

function getDueReminders(now) {
  if (!db) return []
  const stmt = db.prepare('SELECT * FROM notes WHERE remindAt IS NOT NULL AND reminded = 0 AND remindAt <= ?')
  stmt.bind([now])
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function markNoteReminded(id) {
  if (!db) return
  db.run('UPDATE notes SET reminded = 1 WHERE id = ?', [id])
  save()
}

// ====== Close ======
function close() {
  if (db) {
    saveImmediate()
    db.close()
    db = null
  }
}

module.exports = {
  init, getAll, insert, remove, toggleFavorite, updateContent, updateOcrText,
  clearNonFavorites, cleanOld, close,
  getAllNotes, insertNote, updateNote, deleteNote, toggleNotePin
  , getDueReminders, markNoteReminded
}

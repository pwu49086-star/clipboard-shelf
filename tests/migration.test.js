const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('E:/clipboard-shelf/node_modules/better-sqlite3')

const userData = path.join(os.tmpdir(), `clipboard-shelf-migration-test-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })

// 先手工造一个 v0 旧库（没有 v1.4 新列）
const oldDb = new Database(path.join(userData, 'shelf.db'))
oldDb.exec(`
  CREATE TABLE items (
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
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    color TEXT DEFAULT '#f5f0a8',
    isPinned INTEGER DEFAULT 0,
    createTime INTEGER NOT NULL,
    updateTime INTEGER NOT NULL
  );
`)
oldDb.prepare('INSERT INTO items (type, content, createTime) VALUES (?, ?, ?)').run('text', 'legacy row', Date.now())
oldDb.prepare('INSERT INTO notes (title, content, createTime, updateTime) VALUES (?, ?, ?, ?)').run('旧便签', '内容', Date.now(), Date.now())
oldDb.close()

process.env.CLIPBOARD_SHELF_TEST_ROOT = userData
const db = require('../src/main/services/db-service.js')

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('migration adds v1.4 columns and preserves old data', () => {
  const cols = db.getAll({ limit: 10 })
  assert.ok(cols.some(i => i.content === 'legacy row'))
  const probe = cols.find(i => i.content === 'legacy row')
  assert.strictEqual(probe.sourceApp, null)
  assert.strictEqual(probe.sensitivity, 0)
  assert.strictEqual(probe.metadataOnly, 0)
})

test('migration user_version is 1 and new columns writable', () => {
  const item = db.insert({
    type: 'text',
    content: 'new row',
    createTime: Date.now(),
    sourceApp: 'chrome',
    sourceProcess: 'chrome.exe',
    capturedAt: Date.now(),
    sensitivity: 1,
    metadataOnly: 0
  })
  const row = db.getAll({ limit: 100 }).find(i => i.id === item.id)
  assert.strictEqual(row.sourceApp, 'chrome')
  assert.strictEqual(row.sourceProcess, 'chrome.exe')
  assert.strictEqual(row.sensitivity, 1)
})

test('notes survive migration', () => {
  const notes = db.getAllNotes()
  assert.ok(notes.some(n => n.title === '旧便签'))
})

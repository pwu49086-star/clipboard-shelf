const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('../node_modules/better-sqlite3')

const userData = path.join(os.tmpdir(), `clipboard-shelf-entity-migration-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })

// 手工构造 v1 数据库（含 v1.4 列，无 entityState / entities），user_version=1
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
    imageHeight INTEGER,
    sourceApp TEXT,
    sourceProcess TEXT,
    capturedAt INTEGER,
    sensitivity INTEGER DEFAULT 0,
    metadataOnly INTEGER DEFAULT 0
  );
  CREATE TABLE notes (
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
  PRAGMA user_version = 1;
`)
oldDb.prepare('INSERT INTO items (type, content, createTime, sensitivity, metadataOnly) VALUES (?, ?, ?, ?, ?)')
  .run('text', 'legacy-row', Date.now(), 0, 0)
oldDb.prepare('INSERT INTO notes (title, content, createTime, updateTime) VALUES (?, ?, ?, ?)')
  .run('旧便签', '内容', Date.now(), Date.now())
oldDb.close()

process.env.CLIPBOARD_SHELF_USER_DATA = userData
const db = require('../src/main/services/db-service.js')

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('v1 → v3 migration: entities/worksites tables + new columns, legacy data intact', () => {
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 3)
  const entCount = raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='entities'").get().c
  assert.strictEqual(entCount, 1)
  const wsCount = raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='worksites'").get().c
  assert.strictEqual(wsCount, 1)
  const cols = raw.prepare('PRAGMA table_info(items)').all().map(c => c.name)
  assert.ok(cols.includes('entityState'))
  assert.ok(cols.includes('worksiteId'))
  raw.close()

  const all = db.getAll({ limit: 10 })
  assert.ok(all.some(i => i.content === 'legacy-row'))
  assert.ok(db.getAllNotes().some(n => n.title === '旧便签'))
})

test('migrated database can insert and read entities', () => {
  const item = db.insert({ type: 'text', content: '大金 RXYQ16AYM', createTime: Date.now() })
  db.insertEntities(item.id, [{ type: 'model', value: 'RXYQ16AYM', confidence: 90, match_type: 'regex' }])
  const ents = db.getEntitiesByItem(item.id)
  assert.strictEqual(ents.length, 1)
  assert.strictEqual(ents[0].value, 'RXYQ16AYM')
})

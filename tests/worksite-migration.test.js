const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('../node_modules/better-sqlite3')

const userData = path.join(os.tmpdir(), `clipboard-shelf-worksite-migration-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })

// 手工构造 v2 数据库（含 entityState / entities，无 worksites / worksiteId），user_version=2
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
    metadataOnly INTEGER DEFAULT 0,
    entityState INTEGER DEFAULT 0
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
  CREATE TABLE entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    match_type TEXT NOT NULL,
    createTime INTEGER NOT NULL
  );
  CREATE INDEX idx_entities_item ON entities(item_id);
  CREATE INDEX idx_entities_type_value ON entities(type, value);
  PRAGMA user_version = 2;
`)
const now = Date.now()
const ins = oldDb.prepare(`
  INSERT INTO items (type, content, createTime, isFavorite, sensitivity, metadataOnly, entityState)
  VALUES ('text', ?, ?, 0, 0, 0, 1)
`)
for (let i = 0; i < 2100; i++) ins.run(`legacy-${i}`, now - i * 1000)
const fav = oldDb.prepare(`
  INSERT INTO items (type, content, createTime, isFavorite, sensitivity, metadataOnly, entityState)
  VALUES ('text', 'legacy-fav', ?, 1, 0, 0, 1)
`).run(now - 999999999)
oldDb.prepare('INSERT INTO entities (item_id, type, value, confidence, match_type, createTime) VALUES (?, ?, ?, ?, ?, ?)')
  .run(Number(fav.lastInsertRowid), 'model', 'RXYQ16AYM', 90, 'regex', now)
oldDb.prepare('INSERT INTO notes (title, content, createTime, updateTime) VALUES (?, ?, ?, ?)')
  .run('旧便签', '内容', now, now)
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

test('v2 → v5 migration: worksites/annotations tables + columns, 2000+ legacy data intact', () => {
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 5)
  assert.strictEqual(
    raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='worksites'").get().c,
    1
  )
  const cols = raw.prepare('PRAGMA table_info(items)').all().map(c => c.name)
  assert.ok(cols.includes('worksiteId'))
  assert.strictEqual(
    raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name='idx_items_worksite'").get().c,
    1
  )
  assert.strictEqual(raw.prepare('SELECT COUNT(*) c FROM items').get().c, 2101)
  assert.strictEqual(raw.prepare('SELECT COUNT(*) c FROM items WHERE worksiteId IS NOT NULL').get().c, 0)
  assert.strictEqual(raw.prepare('SELECT COUNT(*) c FROM entities').get().c, 1)
  assert.strictEqual(raw.prepare('SELECT COUNT(*) c FROM notes').get().c, 1)
  raw.close()

  const all = db.getAll({ limit: 5000 })
  assert.strictEqual(all.length, 2101)
  assert.ok(all.some(i => i.content === 'legacy-0'))
  assert.ok(all.some(i => i.content === 'legacy-fav' && i.isFavorite === 1))
  assert.strictEqual(db.getAllNotes().some(n => n.title === '旧便签'), true)
})

test('re-init is idempotent and stays v5', async () => {
  db.close()
  await db.init()
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 5)
  raw.close()
  assert.deepStrictEqual(db.listWorksites(), [])
})

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('../node_modules/better-sqlite3')

const userData = path.join(os.tmpdir(), `clipboard-shelf-annotation-migration-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })

// 手工构造 v3 数据库（含 worksites / worksiteId，无 annotations / annotatedPath），user_version=3
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
    entityState INTEGER DEFAULT 0,
    worksiteId INTEGER
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
  CREATE TABLE worksites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    note TEXT DEFAULT '',
    archived INTEGER DEFAULT 0,
    createTime INTEGER NOT NULL,
    updateTime INTEGER NOT NULL
  );
  PRAGMA user_version = 3;
`)
const now = Date.now()
oldDb.prepare(`
  INSERT INTO items (type, content, filePath, thumbPath, createTime, imageWidth, imageHeight)
  VALUES ('image', 'old.png', 'C:\\x\\old.png', 'C:\\x\\old.jpg', ?, 100, 80)
`).run(now)
oldDb.prepare(`
  INSERT INTO items (type, content, createTime, worksiteId)
  VALUES ('text', 'legacy-annotation-migration', ?, NULL)
`).run(now - 1000)
oldDb.prepare('INSERT INTO worksites (title, createTime, updateTime) VALUES (?, ?, ?)').run('旧现场', now, now)
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

test('v3 → v5 migration: annotations table + annotatedPath column, legacy data intact', () => {
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 5)
  assert.strictEqual(
    raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='annotations'").get().c,
    1
  )
  const cols = raw.prepare('PRAGMA table_info(items)').all().map(c => c.name)
  assert.ok(cols.includes('annotatedPath'))
  assert.strictEqual(raw.prepare('SELECT COUNT(*) c FROM items WHERE annotatedPath IS NOT NULL').get().c, 0)
  assert.strictEqual(raw.prepare('SELECT COUNT(*) c FROM items').get().c, 2)
  assert.strictEqual(raw.prepare('SELECT COUNT(*) c FROM worksites').get().c, 1)
  raw.close()

  const all = db.getAll({ limit: 100 })
  assert.ok(all.some(i => i.content === 'legacy-annotation-migration'))
  assert.ok(all.some(i => i.type === 'image' && i.annotatedPath === null))
})

test('re-init is idempotent and stays v5', async () => {
  db.close()
  await db.init()
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 5)
  raw.close()
  assert.deepStrictEqual(db.getAnnotations(1), [])
})

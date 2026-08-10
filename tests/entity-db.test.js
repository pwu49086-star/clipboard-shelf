const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('../node_modules/better-sqlite3')

const userData = path.join(os.tmpdir(), `clipboard-shelf-entity-db-test-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })
process.env.CLIPBOARD_SHELF_USER_DATA = userData

const db = require('../src/main/services/db-service.js')
const entityRecognition = require('../src/main/services/entity-recognition.js')
const { eventBus, Events } = require('../src/main/core/event-bus.js')

test.before(async () => {
  await db.init()
  entityRecognition.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('fresh database migrates to v2 with entities table and entityState column', () => {
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 2)
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities'").all()
  assert.strictEqual(tables.length, 1)
  const cols = raw.prepare('PRAGMA table_info(items)').all().map(c => c.name)
  assert.ok(cols.includes('entityState'))
  raw.close()
})

test('insertEntities persists entities and marks item processed', () => {
  const item = db.insert({ type: 'text', content: '大金 RXYQ16AYM U4', createTime: Date.now() })
  db.insertEntities(item.id, [
    { type: 'brand', value: '大金', confidence: 90, match_type: 'dict' },
    { type: 'model', value: 'RXYQ16AYM', confidence: 90, match_type: 'regex' },
    { type: 'fault_code', value: 'U4', confidence: 90, match_type: 'context' }
  ])
  const ents = db.getEntitiesByItem(item.id)
  assert.strictEqual(ents.length, 3)
  assert.ok(ents.some(e => e.type === 'brand' && e.value === '大金'))
  const row = db.getAll({ limit: 100 }).find(i => i.id === item.id)
  assert.strictEqual(row.entityState, 1)
})

test('markEntityState can mark skipped (2)', () => {
  const item = db.insert({ type: 'text', content: 'sensitive', createTime: Date.now() })
  db.markEntityState(item.id, 2)
  const row = db.getAll({ limit: 100 }).find(i => i.id === item.id)
  assert.strictEqual(row.entityState, 2)
})

test('entity recognition async job persists entities and emits ENTITY_DONE', async () => {
  let done = null
  const off = eventBus.on(Events.ENTITY_DONE, (d) => { done = d })
  eventBus.emit(Events.CLIPBOARD_TEXT, {
    type: 'text',
    content: '格力 GMV-450W 报 E6',
    sensitivity: 0,
    metadataOnly: 0,
    createTime: Date.now()
  })
  await entityRecognition.flush()

  const row = db.getAll({ limit: 100 }).find(i => i.content === '格力 GMV-450W 报 E6')
  assert.ok(row, 'item must be inserted')
  assert.strictEqual(row.entityState, 1)
  const ents = db.getEntitiesByItem(row.id)
  assert.ok(ents.some(e => e.type === 'brand' && e.value === '格力'))
  assert.ok(ents.some(e => e.type === 'model' && e.value === 'GMV450W'))
  assert.ok(ents.some(e => e.type === 'fault_code' && e.value === 'E6'))
  assert.ok(done && done.itemId === row.id)
  off()
})

test('privacy gate: sensitive/metadataOnly/null content are not analyzed', async () => {
  const jobs = []
  const off = eventBus.on(Events.ENTITY_JOB, (job) => jobs.push(job))

  eventBus.emit(Events.CLIPBOARD_TEXT, { type: 'text', content: '大金 U4', sensitivity: 1, metadataOnly: 0, createTime: Date.now() })
  eventBus.emit(Events.CLIPBOARD_TEXT, { type: 'text', content: '大金 U4', sensitivity: 2, metadataOnly: 0, createTime: Date.now() })
  eventBus.emit(Events.CLIPBOARD_TEXT, { type: 'text', content: '大金 U4', sensitivity: 0, metadataOnly: 1, createTime: Date.now() })
  eventBus.emit(Events.CLIPBOARD_TEXT, { type: 'text', content: null, sensitivity: 0, metadataOnly: 0, createTime: Date.now() })
  await entityRecognition.flush()

  const nonEmpty = jobs.filter(j => j.content)
  assert.strictEqual(nonEmpty.length, 0, 'no job should carry content for gated items')
  // 门禁项应标记跳过
  const rows = db.getAll({ limit: 100 }).filter(i => i.content === '大金 U4' || i.content === null)
  for (const r of rows) {
    assert.strictEqual(r.entityState, 2, 'gated item should be marked skipped')
    assert.strictEqual(db.getEntitiesByItem(r.id).length, 0)
  }
  off()
})

test('privacy gate: encrypted locked state is not analyzed', async () => {
  const encryption = require('../src/main/services/encryption-service.js')
  encryption.init()
  const r = encryption.enable('test1234')
  assert.ok(r.ok)
  encryption.lock()

  const jobs = []
  const off = eventBus.on(Events.ENTITY_JOB, (job) => jobs.push(job))
  const before = db.getAll({ limit: 10000 }).length
  eventBus.emit(Events.CLIPBOARD_TEXT, { type: 'text', content: '大金 RXYQ16AYM', sensitivity: 0, metadataOnly: 0, createTime: Date.now() })
  await entityRecognition.flush()

  const after = db.getAll({ limit: 10000 }).length
  assert.strictEqual(after, before, 'locked insert must not create rows')
  assert.strictEqual(jobs.filter(j => j.content).length, 0)
  off()
  encryption.disable('test1234')
  encryption.lock()
})

test('deleting items cascades entity rows', () => {
  const fav = db.insert({ type: 'text', content: 'fav-entity', createTime: Date.now() })
  const nf = db.insert({ type: 'text', content: 'nf-entity', createTime: Date.now() })
  db.insertEntities(fav.id, [{ type: 'brand', value: '大金', confidence: 90, match_type: 'dict' }])
  db.insertEntities(nf.id, [{ type: 'brand', value: '格力', confidence: 90, match_type: 'dict' }])
  db.toggleFavorite(fav.id)

  db.remove(nf.id)
  assert.strictEqual(db.getEntitiesByItem(nf.id).length, 0)

  db.clearNonFavorites()
  assert.strictEqual(db.getEntitiesByItem(fav.id).length, 1)

  const item = db.insert({ type: 'text', content: 'old-entity', createTime: Date.now() - 86400000 })
  db.insertEntities(item.id, [{ type: 'model', value: 'RXYQ16AYM', confidence: 90, match_type: 'regex' }])
  db.cleanByPolicy({ enabled: true, maxItems: 1, maxDays: 0, maxImageItems: 0 })
  assert.strictEqual(db.getEntitiesByItem(item.id).length, 0)
})

test('re-init after close is idempotent and stays v2', async () => {
  db.close()
  await db.init()
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 2)
  const entCount = raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='entities'").get().c
  assert.strictEqual(entCount, 1)
  raw.close()
})

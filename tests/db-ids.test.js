const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const userData = path.join(os.tmpdir(), `clipboard-shelf-db-ids-test-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })
process.env.CLIPBOARD_SHELF_TEST_ROOT = userData

const db = require('../src/main/services/db-service.js')

function seed(content, entities) {
  const item = db.insert({ type: 'text', content, createTime: Date.now() })
  if (entities && entities.length) db.insertEntities(item.id, entities)
  return item
}

let a, b, c

test.before(async () => {
  await db.init()
  a = seed('id-a 大金', [{ type: 'brand', value: '大金', confidence: 90, match_type: 'dict' }])
  b = seed('id-b RXYQ16AYM', [{ type: 'model', value: 'RXYQ16AYM', confidence: 90, match_type: 'regex' }])
  c = seed('id-c 普通')
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('getAll without ids behaves unchanged', () => {
  const rows = db.getAll({ limit: 100 })
  assert.ok(rows.length >= 3)
  assert.ok(rows.some(i => i.id === a.id))
})

test('getAll ids=[] returns empty, not full table', () => {
  assert.deepStrictEqual(db.getAll({ ids: [], limit: 100 }), [])
})

test('getAll ids returns exactly those records', () => {
  const rows = db.getAll({ ids: [a.id, c.id], limit: 100 })
  assert.strictEqual(rows.length, 2)
  const ids = new Set(rows.map(i => i.id))
  assert.ok(ids.has(a.id) && ids.has(c.id))
})

test('getAll ids with missing id skips it', () => {
  const rows = db.getAll({ ids: [a.id, 999999, c.id], limit: 100 })
  assert.strictEqual(rows.length, 2)
})

test('getAll ids intersects with entityFilters', () => {
  const rows = db.getAll({
    ids: [a.id, b.id, c.id],
    entityFilters: [{ type: 'brand', value: '大金' }],
    limit: 100
  })
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].id, a.id)

  const none = db.getAll({
    ids: [c.id],
    entityFilters: [{ type: 'model', value: 'RXYQ16AYM' }],
    limit: 100
  })
  assert.strictEqual(none.length, 0)
})

test('getAll ids AND plain search', () => {
  const rows = db.getAll({ ids: [a.id, b.id, c.id], search: 'id-b', limit: 100 })
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].id, b.id)
})

test('getAll ids with withEntities attaches entities', () => {
  const rows = db.getAll({ ids: [a.id], limit: 100, withEntities: true })
  assert.strictEqual(rows.length, 1)
  assert.ok(rows[0].entities.some(e => e.type === 'brand' && e.value === '大金'))
})

test('getAll ids >500 uses chunked IN', () => {
  const ids = []
  for (let i = 0; i < 550; i++) {
    const item = db.insert({ type: 'text', content: `chunk-${i}-${Date.now()}`, createTime: Date.now() })
    ids.push(item.id)
  }
  const rows = db.getAll({ ids, limit: 10000 })
  assert.strictEqual(rows.length, 550)
})

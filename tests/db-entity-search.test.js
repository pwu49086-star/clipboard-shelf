const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const userData = path.join(os.tmpdir(), `clipboard-shelf-entity-search-test-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })
process.env.CLIPBOARD_SHELF_USER_DATA = userData

const db = require('../src/main/services/db-service.js')

function seed(content, entities, createTime = Date.now()) {
  const item = db.insert({ type: 'text', content, createTime })
  if (entities && entities.length) {
    db.insertEntities(item.id, entities)
  }
  return item
}

test.before(async () => {
  await db.init()
  seed('大金 RXYQ16AYM 故障 U4 制冷剂 R410A', [
    { type: 'brand', value: '大金', confidence: 90, match_type: 'dict' },
    { type: 'model', value: 'RXYQ16AYM', confidence: 90, match_type: 'regex' },
    { type: 'fault_code', value: 'U4', confidence: 90, match_type: 'context' },
    { type: 'refrigerant', value: 'R410A', confidence: 90, match_type: 'dict' }
  ], Date.now() - 3000)
  seed('格力 GMV-450W 报 E6', [
    { type: 'brand', value: '格力', confidence: 90, match_type: 'dict' },
    { type: 'model', value: 'GMV450W', confidence: 90, match_type: 'regex' },
    { type: 'fault_code', value: 'E6', confidence: 90, match_type: 'context' }
  ], Date.now() - 2000)
  seed('美的 MDV-560W', [
    { type: 'brand', value: '美的', confidence: 90, match_type: 'dict' },
    { type: 'model', value: 'MDV560W', confidence: 90, match_type: 'regex' }
  ], Date.now() - 1000)
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('entity filter: brand exact', () => {
  const rows = db.getAll({ limit: 100, entityFilters: [{ type: 'brand', value: '大金' }] })
  assert.strictEqual(rows.length, 1)
  assert.ok(rows[0].content.includes('RXYQ16AYM'))
})

test('entity filter: model normalized match (GMV-450W query)', () => {
  const rows = db.getAll({ limit: 100, entityFilters: [{ type: 'model', value: 'GMV-450W' }] })
  assert.strictEqual(rows.length, 1)
  assert.ok(rows[0].content.includes('GMV-450W'))
})

test('entity filter: fault_code and refrigerant exact', () => {
  assert.strictEqual(db.getAll({ limit: 100, entityFilters: [{ type: 'fault_code', value: 'u4' }] }).length, 1)
  assert.strictEqual(db.getAll({ limit: 100, entityFilters: [{ type: 'refrigerant', value: 'r410a' }] }).length, 1)
})

test('multi entity filters are AND', () => {
  const rows = db.getAll({ limit: 100, entityFilters: [
    { type: 'brand', value: '大金' },
    { type: 'fault_code', value: 'U4' }
  ] })
  assert.strictEqual(rows.length, 1)

  const none = db.getAll({ limit: 100, entityFilters: [
    { type: 'brand', value: '大金' },
    { type: 'fault_code', value: 'E6' }
  ] })
  assert.strictEqual(none.length, 0)
})

test('entity filter AND plain keyword', () => {
  const rows = db.getAll({
    limit: 100,
    search: '报',
    entityFilters: [{ type: 'brand', value: '格力' }]
  })
  assert.strictEqual(rows.length, 1)
  assert.ok(rows[0].content.includes('报 E6'))

  const none = db.getAll({
    limit: 100,
    search: '不存在的词',
    entityFilters: [{ type: 'brand', value: '格力' }]
  })
  assert.strictEqual(none.length, 0)
})

test('CJK search still attaches entities (P2 regression)', () => {
  const rows = db.getAll({ limit: 100, search: '大金', withEntities: true })
  assert.ok(rows.length >= 1, 'CJK search should find 大金 records')
  const r = rows.find(x => (x.content || '').includes('RXYQ16AYM'))
  assert.ok(r, 'should find the seeded 大金 record')
  assert.ok(
    Array.isArray(r.entities) && r.entities.length >= 4,
    'entities must be attached on CJK search path'
  )
})

test('empty entity filter result short-circuits', () => {
  const rows = db.getAll({ limit: 100, search: 'RXYQ16AYM', entityFilters: [{ type: 'brand', value: '不存在' }] })
  assert.strictEqual(rows.length, 0)
})

test('withEntities attaches entities in display order', () => {
  const rows = db.getAll({ limit: 100, entityFilters: [{ type: 'model', value: 'RXYQ16AYM' }], withEntities: true })
  assert.strictEqual(rows.length, 1)
  const types = rows[0].entities.map(e => e.type)
  assert.deepStrictEqual(types, ['brand', 'model', 'fault_code', 'refrigerant'])
})

test('sort=time orders by createTime DESC', () => {
  const rows = db.getAll({ limit: 100, entityFilters: [{ type: 'brand', value: '大金' }], sort: 'time' })
  assert.ok(rows.length >= 1)
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].createTime >= rows[i].createTime)
  }
})

test('entity filter combines with type and favorite', () => {
  const fav = db.insert({ type: 'text', content: '收藏 大金 U4', createTime: Date.now() })
  db.insertEntities(fav.id, [
    { type: 'brand', value: '大金', confidence: 90, match_type: 'dict' },
    { type: 'fault_code', value: 'U4', confidence: 90, match_type: 'context' }
  ])
  db.toggleFavorite(fav.id)

  const favs = db.getAll({ limit: 100, favorite: true, entityFilters: [{ type: 'fault_code', value: 'U4' }] })
  assert.ok(favs.some(i => i.id === fav.id))
  const texts = db.getAll({ limit: 100, type: 'text', entityFilters: [{ type: 'brand', value: '美的' }] })
  assert.ok(texts.every(i => i.type === 'text'))
})

test('sensitive/metadataOnly rows never expose entities via withEntities', () => {
  const s = db.insert({ type: 'text', content: '大金 U4', sensitivity: 1, createTime: Date.now() })
  const rows = db.getAll({ limit: 100, withEntities: true }).filter(i => i.id === s.id)
  assert.ok(rows.length === 0 || rows.every(i => (i.entities || []).length === 0))
})

test('withEntities scales at 200/1000/5000 rows', () => {
  const results = {}
  for (const n of [200, 1000, 5000]) {
    for (let i = 0; i < n; i++) {
      db.insert({ type: 'text', content: `scale-${i}-${n}`, createTime: Date.now() - i })
    }
    const t0 = Date.now()
    const rows = db.getAll({ limit: n, withEntities: true })
    const elapsed = Date.now() - t0
    results[n] = { elapsedMs: elapsed, returned: rows.length }
  }
  console.log('[entity-search-bench] ' + JSON.stringify(results))
  assert.ok(results[200].elapsedMs < 200, '200 rows withEntities must be fast')
  assert.ok(results[5000].elapsedMs < 500, '5000 rows withEntities must be acceptable')
})

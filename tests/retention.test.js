const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const { resolvePolicy, configure, getPolicy } = require('../src/main/services/retention.js')

const userData = path.join(os.tmpdir(), `clipboard-shelf-retention-test-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })
process.env.CLIPBOARD_SHELF_USER_DATA = userData

const db = require('../src/main/services/db-service.js')

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('resolvePolicy applies defaults', () => {
  const p = resolvePolicy({})
  assert.strictEqual(p.enabled, true)
  assert.strictEqual(p.maxItems, 5000)
  assert.strictEqual(p.maxDays, 0)
  assert.strictEqual(p.maxImageItems, 0)
})

test('resolvePolicy normalizes invalid values', () => {
  const p = resolvePolicy({ maxItems: -5, maxDays: 'abc', maxImageItems: 3.9 })
  assert.strictEqual(p.maxItems, 0)
  assert.strictEqual(p.maxDays, 0)
  assert.strictEqual(p.maxImageItems, 3)
})

test('resolvePolicy preserves enabled=false', () => {
  const p = resolvePolicy({ enabled: false, maxItems: 100 })
  assert.strictEqual(p.enabled, false)
  assert.strictEqual(p.maxItems, 100)
})

test('configure stores normalized policy', () => {
  configure({ maxItems: 500, maxDays: 30 })
  const p = getPolicy()
  assert.strictEqual(p.maxItems, 500)
  assert.strictEqual(p.maxDays, 30)
  configure({})
})

test('cleanByPolicy maxItems deletes oldest non-favorites only', () => {
  const fav = db.insert({ type: 'text', content: 'fav-old', createTime: Date.now() - 100000, isFavorite: 0 })
  db.toggleFavorite(fav.id)
  db.insert({ type: 'text', content: 'nf-1', createTime: Date.now() - 90000 })
  db.insert({ type: 'text', content: 'nf-2', createTime: Date.now() - 80000 })

  const deleted = db.cleanByPolicy({ enabled: true, maxItems: 1, maxDays: 0, maxImageItems: 0 })
  assert.strictEqual(deleted.length, 2)
  assert.ok(deleted.every(r => r.id !== fav.id))

  const all = db.getAll({ limit: 100 })
  assert.ok(all.some(i => i.id === fav.id))
  assert.ok(!all.some(i => i.content === 'nf-1'))
  assert.ok(!all.some(i => i.content === 'nf-2'))
})

test('cleanByPolicy maxDays deletes only expired non-favorites', () => {
  const old = db.insert({ type: 'text', content: 'expired', createTime: Date.now() - 10 * 24 * 3600 * 1000 })
  db.insert({ type: 'text', content: 'recent', createTime: Date.now() })

  const deleted = db.cleanByPolicy({ enabled: true, maxItems: 0, maxDays: 7, maxImageItems: 0 })
  assert.ok(deleted.some(r => r.id === old.id))

  const all = db.getAll({ limit: 100 })
  assert.ok(all.some(i => i.content === 'recent'))
  assert.ok(!all.some(i => i.content === 'expired'))
})

test('cleanByPolicy maxImageItems limits non-favorite images only', () => {
  const img1 = db.insert({ type: 'image', content: 'img-1.png', filePath: 'E:\\fake\\img-1.png', createTime: Date.now() - 3000 })
  const img2 = db.insert({ type: 'image', content: 'img-2.png', filePath: 'E:\\fake\\img-2.png', createTime: Date.now() - 2000 })
  const img3 = db.insert({ type: 'image', content: 'img-3.png', filePath: 'E:\\fake\\img-3.png', createTime: Date.now() - 1000 })
  db.insert({ type: 'text', content: 'text-kept', createTime: Date.now() })

  const deleted = db.cleanByPolicy({ enabled: true, maxItems: 0, maxDays: 0, maxImageItems: 2 })
  assert.strictEqual(deleted.length, 1)
  assert.ok(deleted.some(r => r.id === img1.id))

  const all = db.getAll({ limit: 100 })
  assert.ok(all.some(i => i.id === img2.id))
  assert.ok(all.some(i => i.id === img3.id))
  assert.ok(all.some(i => i.content === 'text-kept'))
})

test('cleanByPolicy enabled=false deletes nothing', () => {
  db.insert({ type: 'text', content: 'never-delete', createTime: Date.now() - 20 * 24 * 3600 * 1000 })
  const deleted = db.cleanByPolicy({ enabled: false, maxItems: 0, maxDays: 1, maxImageItems: 0 })
  assert.strictEqual(deleted.length, 0)
  const all = db.getAll({ limit: 100 })
  assert.ok(all.some(i => i.content === 'never-delete'))
})

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-dryrun-'))
process.env.CLIPBOARD_SHELF_TEST_ROOT = ROOT
const db = require('../src/main/services/db-service.js')
const retention = require('../src/main/services/retention.js')

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {}
})

test('dry-run reports counts without deleting', () => {
  const now = Date.now()
  const keep = db.insert({ type: 'text', content: 'keep', createTime: now })
  db.toggleFavorite(keep.id)
  const d1 = db.insert({ type: 'text', content: 'drop-1', createTime: now - 5000 })
  const imgPath = path.join(ROOT, 'images/full/x.png')
  fs.mkdirSync(path.dirname(imgPath), { recursive: true })
  fs.writeFileSync(imgPath, '12345')
  const d2 = db.insert({ type: 'image', content: 'x.png', filePath: imgPath, createTime: now - 4000 })

  retention.configure({ enabled: true, maxItems: 1, maxDays: 0, maxImageItems: 0 })
  const peek = retention.dryRun()
  assert.strictEqual(peek.enabled, true)
  assert.strictEqual(peek.itemCount, 2)
  assert.strictEqual(peek.imageCount, 1)
  assert.strictEqual(peek.bytesFreed, 5)
  // dry-run 后数据仍在
  assert.ok(db.getAll({ limit: 100 }).some(i => i.id === d1.id))
  assert.ok(db.getAll({ limit: 100 }).some(i => i.id === d2.id))
  assert.ok(fs.existsSync(imgPath))

  // 真实执行
  retention.run()
  assert.ok(!db.getAll({ limit: 100 }).some(i => i.id === d1.id))
  assert.ok(!db.getAll({ limit: 100 }).some(i => i.id === d2.id))
  assert.ok(!fs.existsSync(imgPath))
  assert.ok(db.getAll({ limit: 100 }).some(i => i.id === keep.id))
})

test('dry-run is disabled when retention disabled', () => {
  retention.configure({ enabled: false })
  const peek = retention.dryRun()
  assert.strictEqual(peek.enabled, false)
  assert.strictEqual(peek.itemCount, 0)
})

test('dry-run accepts explicit policy without applying it', () => {
  const now = Date.now()
  for (let i = 0; i < 10; i++) db.insert({ type: 'text', content: 'extra-' + i, createTime: now - i })
  retention.configure({ enabled: true, maxItems: 5000, maxDays: 0, maxImageItems: 0 })
  const peek = retention.dryRun({ enabled: true, maxItems: 3, maxDays: 0, maxImageItems: 0 })
  assert.strictEqual(peek.enabled, true)
  assert.ok(peek.itemCount >= 7, `expected >=7, got ${peek.itemCount}`)
  // 策略未被应用：当前 policy 仍是 5000，数据未删
  assert.strictEqual(retention.getPolicy().maxItems, 5000)
  assert.ok(db.getAll({ limit: 100 }).length >= 8)
})

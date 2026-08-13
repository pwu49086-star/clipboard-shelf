const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const userData = path.join(os.tmpdir(), `clipboard-shelf-enc-test-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })
process.env.CLIPBOARD_SHELF_TEST_ROOT = userData

const encryption = require('../src/main/services/encryption-service.js')
const db = require('../src/main/services/db-service.js')

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('status starts disabled', () => {
  const s = encryption.getStatus()
  assert.strictEqual(s.enabled, false)
})

test('enable requires 4+ chars', () => {
  assert.ok(encryption.enable('abc').error)
  assert.ok(encryption.enable('pass1234').ok)
})

test('insert/getAll roundtrip while unlocked', () => {
  const item = db.insert({ type: 'text', content: 'secret hello', createTime: Date.now() })
  const all = db.getAll({ limit: 50 })
  assert.ok(all.some(i => i.id === item.id && i.content === 'secret hello'))
})

test('wrong password rejected, correct password unlocks', () => {
  assert.ok(encryption.unlock('wrong').error)
  assert.ok(encryption.unlock('pass1234').ok)
})

test('locked rows cannot be read, unlock restores', () => {
  const item = db.insert({ type: 'text', content: 'locked secret', createTime: Date.now() })
  encryption.lock()
  const locked = db.getAll({ limit: 50 }).find(i => i.id === item.id)
  assert.strictEqual(locked.content, '')
  assert.ok(encryption.unlock('pass1234').ok)
  const unlocked = db.getAll({ limit: 50 }).find(i => i.id === item.id)
  assert.strictEqual(unlocked.content, 'locked secret')
})

test('search works while unlocked', () => {
  db.insert({ type: 'text', content: 'unique-search-token-42', createTime: Date.now() })
  const hits = db.getAll({ search: 'unique-search-token-42', limit: 10 })
  assert.ok(hits.some(i => i.content === 'unique-search-token-42'))
})

test('disable decrypts all rows back', () => {
  assert.ok(encryption.disable('pass1234').ok)
  db.decryptAllAndRebuildFts()
  const all = db.getAll({ limit: 100 })
  assert.ok(all.some(i => i.content === 'secret hello'))
  assert.ok(all.every(i => typeof i.content === 'string'))
  const s = encryption.getStatus()
  assert.strictEqual(s.enabled, false)
})

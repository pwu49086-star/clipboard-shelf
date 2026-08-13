const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('../node_modules/better-sqlite3')

const userData = path.join(os.tmpdir(), `clipboard-shelf-annotation-db-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })
process.env.CLIPBOARD_SHELF_USER_DATA = userData

const db = require('../src/main/services/db-service.js')
const encryption = require('../src/main/services/encryption-service.js')

function seedImage(extra = {}) {
  return db.insert({
    type: 'image',
    content: `${Date.now()}_x.png`,
    filePath: `C:\\x\\full\\${Date.now()}_x.png`,
    thumbPath: `C:\\x\\thumb\\${Date.now()}_x.jpg`,
    imageWidth: 100,
    imageHeight: 80,
    createTime: Date.now(),
    ...extra
  })
}

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('fresh empty database migrates to v4', () => {
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 4)
  raw.close()
})

test('annotation CRUD: replace keeps flattened mosaic rows', () => {
  const item = seedImage()
  db.replaceAnnotations(item.id, [
    { id: 'r1', kind: 'rect', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#e11', strokeWidth: 3 },
    { id: 'm1', kind: 'mosaic', points: [{ x: 0, y: 0 }, { x: 32, y: 32 }], blockSize: 16, flattened: true }
  ])
  let els = db.getAnnotations(item.id)
  assert.strictEqual(els.length, 2)
  assert.strictEqual(els[0].kind, 'rect')
  assert.strictEqual(els[1].kind, 'mosaic')
  assert.strictEqual(els[1].flattened, true)

  db.replaceAnnotations(item.id, [
    { id: 't1', kind: 'text', points: [{ x: 5, y: 5 }], text: 'OK', fontSize: 32, color: '#000' }
  ])
  els = db.getAnnotations(item.id)
  assert.strictEqual(els.length, 2, 'mosaic row must be kept')
  assert.ok(els.some(e => e.kind === 'mosaic'))
  assert.ok(els.some(e => e.kind === 'text'))
  assert.ok(!els.some(e => e.kind === 'rect'))
})

test('setItemAnnotatedPath flows through getAll', () => {
  const item = seedImage()
  const p = `C:\\x\\annotated\\${item.id}_1.png`
  db.setItemAnnotatedPath(item.id, p)
  const row = db.getAll({ limit: 100 }).find(i => i.id === item.id)
  assert.strictEqual(row.annotatedPath, p)
})

test('remove deletes annotation rows and returns annotatedPath', () => {
  const item = seedImage()
  db.replaceAnnotations(item.id, [{ id: 'a', kind: 'rect', points: [] }])
  db.setItemAnnotatedPath(item.id, `C:\\x\\annotated\\${item.id}_1.png`)
  const removed = db.remove(item.id)
  assert.strictEqual(removed.annotatedPath, `C:\\x\\annotated\\${item.id}_1.png`)
  assert.deepStrictEqual(db.getAnnotations(item.id), [])
})

test('clearNonFavorites removes annotations of non-favorite images', () => {
  const keep = seedImage()
  const drop = seedImage()
  db.toggleFavorite(keep.id)
  db.replaceAnnotations(keep.id, [{ id: 'k1', kind: 'rect', points: [] }])
  db.replaceAnnotations(drop.id, [{ id: 'd1', kind: 'rect', points: [] }])
  db.clearNonFavorites()
  assert.strictEqual(db.getAnnotations(keep.id).length, 1)
  assert.deepStrictEqual(db.getAnnotations(drop.id), [])
})

test('cleanByPolicy: worksite images protected, others cleaned with annotations', () => {
  const ws = db.createWorksite({ title: '保留' })
  const inWs = seedImage()
  const outside = seedImage()
  db.replaceAnnotations(inWs.id, [{ id: 'i1', kind: 'rect', points: [] }])
  db.replaceAnnotations(outside.id, [{ id: 'o1', kind: 'rect', points: [] }])
  db.setItemsWorksite([inWs.id], ws.id)
  db.cleanByPolicy({ enabled: true, maxItems: 2, maxDays: 0, maxImageItems: 0 })
  const all = db.getAll({ limit: 100 })
  assert.ok(all.some(i => i.id === inWs.id))
  assert.ok(!all.some(i => i.id === outside.id))
  assert.strictEqual(db.getAnnotations(inWs.id).length, 1)
  assert.deepStrictEqual(db.getAnnotations(outside.id), [])
})

test('encryption: annotation data encrypted, locked hides elements', async () => {
  assert.ok(encryption.enable('pass1234').ok)
  const item = seedImage()
  db.replaceAnnotations(item.id, [{ id: 's1', kind: 'text', points: [], text: 'secret-note' }])
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  const row = raw.prepare('SELECT data FROM annotations WHERE item_id = ?').get(item.id)
  assert.ok(row.data.startsWith('enc:v1:'), 'annotation data must be encrypted')
  raw.close()
  encryption.lock()
  assert.deepStrictEqual(db.getAnnotations(item.id), [], 'locked state must not expose elements')
  assert.ok(encryption.unlock('pass1234').ok)
  assert.strictEqual(db.getAnnotations(item.id)[0].text, 'secret-note')
  assert.ok(encryption.disable('pass1234').ok)
  db.decryptAllAndRebuildFts()
})

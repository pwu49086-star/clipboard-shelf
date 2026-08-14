const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('../node_modules/better-sqlite3')

const userData = path.join(os.tmpdir(), `clipboard-shelf-worksite-db-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })
process.env.CLIPBOARD_SHELF_TEST_ROOT = userData

const db = require('../src/main/services/db-service.js')
const encryption = require('../src/main/services/encryption-service.js')
const { buildPlainText } = require('../src/shared/collection-output.cjs')

function seed(content, extra = {}) {
  return db.insert({ type: 'text', content, createTime: Date.now(), ...extra })
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('fresh empty database migrates to v5', () => {
  const raw = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 5)
  raw.close()
  assert.deepStrictEqual(db.listWorksites(), [])
})

test('worksite create rejects empty title, allows empty worksite', () => {
  assert.strictEqual(db.createWorksite({ title: '' }), null)
  assert.strictEqual(db.createWorksite({ title: '   ' }), null)
  const ws = db.createWorksite({ title: '空现场', note: '无记录' })
  assert.ok(ws && ws.id > 0)
  assert.strictEqual(ws.title, '空现场')
  assert.strictEqual(ws.note, '无记录')
  assert.strictEqual(ws.itemCount, 0)
  assert.strictEqual(ws.archived, 0)
  assert.strictEqual(db.listWorksites().length, 1)
})

test('worksite update title/note/archived and empty title rejected', () => {
  const ws = db.createWorksite({ title: '旧标题' })
  const updated = db.updateWorksite(ws.id, { title: '新标题', note: '备注', archived: 1 })
  assert.strictEqual(updated.title, '新标题')
  assert.strictEqual(updated.note, '备注')
  assert.strictEqual(updated.archived, 1)
  assert.strictEqual(db.listWorksites().find(w => w.id === ws.id).archived, 1)
  assert.strictEqual(db.updateWorksite(ws.id, { title: '' }), null)
  assert.strictEqual(db.getWorksite(ws.id).title, '新标题')
  assert.strictEqual(db.updateWorksite(ws.id, { archived: 0 }).archived, 0)
})

test('attach/detach batch updates itemCount and updateTime', async () => {
  const ws = db.createWorksite({ title: '关联现场' })
  const before = ws.updateTime
  await sleep(5)
  const a = seed('ws-a')
  const b = seed('ws-b')
  const c = seed('ws-c')
  const r = db.setItemsWorksite([a.id, b.id, c.id], ws.id)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.updated, 3)
  const after = db.getWorksite(ws.id)
  assert.strictEqual(after.itemCount, 3)
  assert.ok(after.updateTime >= before)
  assert.strictEqual(db.getAll({ worksiteId: ws.id, limit: 100 }).length, 3)

  const detach = db.setItemsWorksite([a.id, b.id, c.id], null)
  assert.strictEqual(detach.ok, true)
  assert.strictEqual(db.getWorksite(ws.id).itemCount, 0)
  assert.ok(db.getAll({ worksiteId: ws.id, limit: 100 }).length === 0)
  assert.ok(db.getAll({ limit: 100 }).some(i => i.id === a.id && i.worksiteId === null))
})

test('attach to missing worksite rejected', () => {
  const item = seed('no-ws')
  const r = db.setItemsWorksite([item.id], 999999)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(db.getAll({ limit: 100 }).find(i => i.id === item.id).worksiteId, null)
})

test('moving between worksites touches both and updates counts', async () => {
  const ws1 = db.createWorksite({ title: '现场1' })
  const ws2 = db.createWorksite({ title: '现场2' })
  const a = seed('move-a')
  const b = seed('move-b')
  const c = seed('move-c')
  db.setItemsWorksite([a.id, b.id, c.id], ws1.id)
  const t1 = db.getWorksite(ws1.id).updateTime
  await sleep(5)
  db.setItemsWorksite([a.id, b.id, c.id], ws2.id)
  assert.strictEqual(db.getWorksite(ws1.id).itemCount, 0)
  assert.strictEqual(db.getWorksite(ws2.id).itemCount, 3)
  assert.ok(db.getWorksite(ws2.id).updateTime >= t1)
})

test('delete worksite only unlinks items, never deletes them', () => {
  const ws = db.createWorksite({ title: '待删现场' })
  const a = seed('keep-a')
  const b = seed('keep-b')
  db.setItemsWorksite([a.id, b.id], ws.id)
  assert.strictEqual(db.deleteWorksite(ws.id), true)
  assert.strictEqual(db.listWorksites().some(w => w.id === ws.id), false)
  const all = db.getAll({ limit: 100 })
  assert.ok(all.some(i => i.id === a.id && i.worksiteId === null))
  assert.ok(all.some(i => i.id === b.id && i.worksiteId === null))
})

test('500+ batch attach/detach works with chunking', () => {
  const ws = db.createWorksite({ title: '大批量' })
  const ids = []
  for (let i = 0; i < 550; i++) ids.push(seed(`chunk-${i}-${Date.now()}-${i}`).id)
  const r = db.setItemsWorksite(ids, ws.id)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(db.getWorksite(ws.id).itemCount, 550)
  const detach = db.setItemsWorksite(ids, null)
  assert.strictEqual(detach.ok, true)
  assert.strictEqual(db.getWorksite(ws.id).itemCount, 0)
})

test('worksiteId AND plain keyword (ASCII FTS) and CJK LIKE', () => {
  const ws = db.createWorksite({ title: '搜索现场' })
  const inModel = seed('RXYQ16AYM 大金 故障 U4')
  const outModel = seed('RXYQ16AYM outside')
  const outCjk = seed('大金 室外机 outside-cjk')
  db.insertEntities(inModel.id, [
    { type: 'brand', value: '大金', confidence: 90, match_type: 'dict' },
    { type: 'model', value: 'RXYQ16AYM', confidence: 90, match_type: 'regex' },
    { type: 'fault_code', value: 'U4', confidence: 90, match_type: 'context' }
  ])
  db.setItemsWorksite([inModel.id], ws.id)

  const ascii = db.getAll({ worksiteId: ws.id, search: 'RXYQ16AYM', limit: 100 })
  assert.strictEqual(ascii.length, 1)
  assert.strictEqual(ascii[0].id, inModel.id)

  const cjk = db.getAll({ worksiteId: ws.id, search: '大金', limit: 100, withEntities: true })
  assert.strictEqual(cjk.length, 1)
  assert.strictEqual(cjk[0].id, inModel.id)
  assert.ok(cjk[0].entities.length >= 1, 'CJK path inside worksite must attach entities (P2 fix)')
  assert.ok(db.getAll({ limit: 100 }).some(i => i.id === outModel.id))
  assert.ok(db.getAll({ limit: 100 }).some(i => i.id === outCjk.id), 'outside CJK item still exists globally')
})

test('worksiteId AND entity filter AND', () => {
  const ws = db.createWorksite({ title: '实体现场' })
  const a = seed('大金 RXYQ16AYM')
  const b = seed('格力 GMV-450W')
  db.insertEntities(a.id, [{ type: 'brand', value: '大金', confidence: 90, match_type: 'dict' }])
  db.insertEntities(b.id, [{ type: 'brand', value: '格力', confidence: 90, match_type: 'dict' }])
  db.setItemsWorksite([a.id, b.id], ws.id)

  const rows = db.getAll({ worksiteId: ws.id, entityFilters: [{ type: 'brand', value: '大金' }], limit: 100 })
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].id, a.id)
})

test('worksiteId AND type/favorite', () => {
  const ws = db.createWorksite({ title: '类型现场' })
  const img = db.insert({ type: 'image', content: 'IMG.png', filePath: 'C:\\x\\IMG.png', createTime: Date.now() })
  const txt = seed('text-in-ws')
  db.setItemsWorksite([img.id, txt.id], ws.id)
  const images = db.getAll({ worksiteId: ws.id, type: 'image', limit: 100 })
  assert.strictEqual(images.length, 1)
  assert.strictEqual(images[0].id, img.id)

  db.toggleFavorite(txt.id)
  const favs = db.getAll({ worksiteId: ws.id, favorite: true, limit: 100 })
  assert.strictEqual(favs.length, 1)
  assert.strictEqual(favs[0].id, txt.id)
  db.toggleFavorite(txt.id)
})

test('retention: cleanByPolicy maxItems protects worksite items', () => {
  const ws = db.createWorksite({ title: '保留现场' })
  const unlinked = [seed(`ret-unlinked-${Date.now()}-1`), seed(`ret-unlinked-${Date.now()}-2`), seed(`ret-unlinked-${Date.now()}-3`)]
  const linked = [seed(`ret-linked-${Date.now()}-1`), seed(`ret-linked-${Date.now()}-2`), seed(`ret-linked-${Date.now()}-3`)]
  db.setItemsWorksite(linked.map(i => i.id), ws.id)
  db.cleanByPolicy({ enabled: true, maxItems: 3, maxDays: 0, maxImageItems: 0 })
  const all = db.getAll({ limit: 10000 })
  for (const i of linked) assert.ok(all.some(x => x.id === i.id), 'linked item must survive')
  for (const i of unlinked) assert.ok(!all.some(x => x.id === i.id), 'unlinked item should be cleaned')
  assert.strictEqual(db.getWorksite(ws.id).itemCount, 3)
})

test('retention: maxDays and maxImageItems protect worksite items', () => {
  const ws = db.createWorksite({ title: '时间现场' })
  const oldLinked = db.insert({ type: 'text', content: `old-linked-${Date.now()}`, createTime: Date.now() - 10 * 86400000 })
  const oldUnlinked = db.insert({ type: 'text', content: `old-unlinked-${Date.now()}`, createTime: Date.now() - 10 * 86400000 })
  db.setItemsWorksite([oldLinked.id], ws.id)
  db.cleanByPolicy({ enabled: true, maxItems: 0, maxDays: 7, maxImageItems: 0 })
  const all = db.getAll({ limit: 10000 })
  assert.ok(all.some(x => x.id === oldLinked.id))
  assert.ok(!all.some(x => x.id === oldUnlinked.id))

  const wsImg = db.createWorksite({ title: '图片现场' })
  const imgIn = db.insert({ type: 'image', content: 'in.png', filePath: 'C:\\x\\in.png', createTime: Date.now() - 100000 })
  const imgOut1 = db.insert({ type: 'image', content: 'out1.png', filePath: 'C:\\x\\out1.png', createTime: Date.now() - 200000 })
  const imgOut2 = db.insert({ type: 'image', content: 'out2.png', filePath: 'C:\\x\\out2.png', createTime: Date.now() - 300000 })
  db.setItemsWorksite([imgIn.id], wsImg.id)
  db.cleanByPolicy({ enabled: true, maxItems: 0, maxDays: 0, maxImageItems: 1 })
  const after = db.getAll({ limit: 10000 })
  assert.ok(after.some(x => x.id === imgIn.id), 'worksite image must survive')
  assert.ok(!after.some(x => x.id === imgOut1.id) || !after.some(x => x.id === imgOut2.id), 'outside images reduced')
})

test('retention: clearNonFavorites protects worksite items', () => {
  const ws = db.createWorksite({ title: '清空保护' })
  const linked = seed(`clr-linked-${Date.now()}`)
  const unlinked = seed(`clr-unlinked-${Date.now()}`)
  const fav = seed(`clr-fav-${Date.now()}`)
  db.toggleFavorite(fav.id)
  db.setItemsWorksite([linked.id], ws.id)
  db.clearNonFavorites()
  const all = db.getAll({ limit: 10000 })
  assert.ok(all.some(x => x.id === linked.id))
  assert.ok(all.some(x => x.id === fav.id))
  assert.ok(!all.some(x => x.id === unlinked.id))
})

test('after detach, items return to normal retention behavior', () => {
  const ws = db.createWorksite({ title: '解除保护' })
  const linked = db.insert({ type: 'text', content: `detach-${Date.now()}`, createTime: Date.now() - 86400000 })
  db.setItemsWorksite([linked.id], ws.id)
  db.setItemsWorksite([linked.id], null)
  db.cleanByPolicy({ enabled: true, maxItems: 1, maxDays: 0, maxImageItems: 0 })
  const all = db.getAll({ limit: 10000 })
  assert.ok(!all.some(x => x.id === linked.id), 'detached item should be cleanable again')
})

test('privacy: worksite output excludes sensitivity=2 / metadataOnly / null', () => {
  const ws = db.createWorksite({ title: '隐私现场' })
  const normal = seed(`priv-normal-${Date.now()}`)
  const high = seed('', { sensitivity: 2, metadataOnly: 1, content: null })
  const meta = seed('meta', { metadataOnly: 1 })
  const empty = seed('', { content: null })
  db.setItemsWorksite([normal.id, high.id, meta.id, empty.id], ws.id)
  const rows = db.getAll({ worksiteId: ws.id, limit: 100, withEntities: true })
  const out = buildPlainText(rows)
  assert.strictEqual(out.count, 1)
  assert.ok(out.text.includes('priv-normal'))
  assert.ok(!out.text.includes('meta'))
  assert.strictEqual(out.excluded, 3)
})

test('encryption locked: worksite view and titles do not leak', async () => {
  assert.ok(encryption.enable('pass1234').ok)
  const ws = db.createWorksite({ title: '客户A', note: '地址保密' })
  const item = seed('secret-content')
  db.setItemsWorksite([item.id], ws.id)
  encryption.lock()

  const lockedItems = db.getAll({ worksiteId: ws.id, limit: 100 })
  assert.strictEqual(lockedItems.length, 1)
  assert.strictEqual(lockedItems[0].content, '')
  const lockedWs = db.listWorksites().find(w => w.id === ws.id)
  assert.strictEqual(lockedWs.title, '')
  assert.strictEqual(lockedWs.note, '')

  assert.ok(encryption.unlock('pass1234').ok)
  const unlockedItems = db.getAll({ worksiteId: ws.id, limit: 100 })
  assert.strictEqual(unlockedItems[0].content, 'secret-content')
  assert.strictEqual(db.listWorksites().find(w => w.id === ws.id).title, '客户A')

  assert.ok(encryption.disable('pass1234').ok)
  db.decryptAllAndRebuildFts()
})

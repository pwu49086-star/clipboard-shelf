const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('../node_modules/better-sqlite3')

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-missing-'))
for (const d of ['images/full', 'images/thumb', 'images/annotated']) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true })
}
process.env.CLIPBOARD_SHELF_TEST_ROOT = ROOT

const db = require('../src/main/services/db-service.js')
const backupService = require('../src/main/services/backup-service.js')
const integrity = require('../src/main/services/asset-integrity.js')

const ITEMS_DDL = `
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, content TEXT, filePath TEXT, thumbPath TEXT, ocrText TEXT,
  isFavorite INTEGER DEFAULT 0, createTime INTEGER NOT NULL, fileSize INTEGER,
  imageWidth INTEGER, imageHeight INTEGER, sourceApp TEXT, sourceProcess TEXT,
  capturedAt INTEGER, sensitivity INTEGER DEFAULT 0, metadataOnly INTEGER DEFAULT 0,
  entityState INTEGER DEFAULT 0, worksiteId INTEGER, annotatedPath TEXT
);`

test.before(async () => {
  const raw = new Database(path.join(ROOT, 'shelf.db'))
  raw.exec(ITEMS_DDL)
  raw.exec(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', color TEXT DEFAULT '#f5f0a8', isPinned INTEGER DEFAULT 0, createTime INTEGER NOT NULL, updateTime INTEGER NOT NULL, remindAt INTEGER, reminded INTEGER DEFAULT 0)`)
  for (const m of db.MIGRATIONS) {
    if (m.version > 4) continue
    for (const sql of m.sql) { try { raw.exec(sql) } catch {} }
  }
  raw.pragma('user_version = 4')
  raw.prepare('INSERT INTO items (type, content, createTime) VALUES (?, ?, ?)').run('text', 'legacy row', Date.now())
  raw.close()
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {}
})

function addImageRow({ state = 'ok', withFile = false, ocr = null, note = '' }) {
  const id = db.insert({ type: 'image', content: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`, ocrText: ocr, createTime: Date.now() }).id
  const full = path.join(ROOT, 'images/full', `${id}.png`)
  if (withFile) fs.writeFileSync(full, 'data')
  const raw = new Database(path.join(ROOT, 'shelf.db'))
  raw.prepare('UPDATE items SET filePath = ?, assetState = ?, assetMissingAt = ?, assetMissingNote = ? WHERE id = ?')
    .run(full, state, state === 'missing' ? Date.now() : null, state === 'missing' ? note : '', id)
  raw.close()
  return { id, full }
}

function removeRow(id, full) {
  db.remove(id)
  if (full && fs.existsSync(full)) fs.unlinkSync(full)
}

test('migration v4 -> v5 additive, default ok, idempotent', async () => {
  const raw = new Database(path.join(ROOT, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 5)
  const itemCols = raw.prepare('PRAGMA table_info(items)').all().map(c => c.name)
  assert.ok(itemCols.includes('assetState'))
  assert.ok(itemCols.includes('assetMissingAt'))
  assert.ok(itemCols.includes('assetMissingNote'))
  const legacy = raw.prepare("SELECT id, content, assetState FROM items WHERE content = 'legacy row'").get()
  assert.ok(legacy)
  assert.strictEqual(legacy.assetState, 'ok')
  raw.close()
  db.close()
  await db.init()
  const raw2 = new Database(path.join(ROOT, 'shelf.db'), { readonly: true })
  assert.strictEqual(raw2.pragma('user_version', { simple: true }), 5)
  raw2.close()
})

test('integrity tri-state: unexpected / permanent / recovered', () => {
  const a = addImageRow({ state: 'ok', withFile: false })
  const b = addImageRow({ state: 'missing', withFile: false, note: 'lost' })
  const c = addImageRow({ state: 'missing', withFile: true, note: 'back' })
  addImageRow({ state: 'ok', withFile: true })
  const r = integrity.scan({ userData: ROOT })
  assert.strictEqual(r.summary.unexpectedMissing, 1)
  assert.strictEqual(r.summary.permanentMissing, 1)
  assert.strictEqual(r.summary.recovered, 1)
  assert.ok(r.lists.missingFiles.some(x => x.itemId === a.id))
  assert.ok(r.lists.permanentMissing.some(x => x.itemId === b.id))
  assert.ok(r.lists.recovered.some(x => x.itemId === c.id))
  for (const row of [a, b, c]) removeRow(row.id, row.full)
})

test('confirm and revoke permanent missing keeps history', () => {
  const a = addImageRow({ state: 'ok', withFile: false, ocr: 'OCR-保持' })
  db.insertEntities(a.id, [{ type: 'brand', value: '大金', confidence: 70, match_type: 'dict' }])
  const res = db.confirmAssetMissing([a.id], '8/11 事故丢失')
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.updated.length, 1)
  const raw = new Database(path.join(ROOT, 'shelf.db'), { readonly: true })
  const row = raw.prepare('SELECT id, assetState, assetMissingAt, assetMissingNote, ocrText FROM items WHERE id = ?').get(a.id)
  raw.close()
  assert.strictEqual(row.assetState, 'missing')
  assert.ok(row.assetMissingAt)
  assert.strictEqual(row.assetMissingNote, '8/11 事故丢失')
  assert.strictEqual(row.ocrText, 'OCR-保持')
  backupService.appendAuditLog(path.join(ROOT, 'backups'), res.updated.map(u => ({ ...u, action: 'confirm', note: '8/11 事故丢失' })))
  const log = backupService.readAuditLog(path.join(ROOT, 'backups'))
  assert.ok(log.some(e => e.action === 'confirm' && e.itemId === a.id && e.oldState === 'ok' && e.newState === 'missing'))
  const rev = db.revokeAssetMissing([a.id])
  assert.strictEqual(rev.updated.length, 1)
  const r = integrity.scan({ userData: ROOT })
  assert.ok(r.lists.missingFiles.some(x => x.itemId === a.id))
  removeRow(a.id, a.full)
})

test('backup: complete when all assets exist', async () => {
  const a = addImageRow({ state: 'ok', withFile: true })
  const r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'test', maxKeep: 3 })
  assert.strictEqual(r.ok, true, r.error)
  assert.strictEqual(r.manifest.assetState, 'complete')
  assert.strictEqual(r.manifest.knownMissingAssets.length, 0)
  const v = backupService.verifyBackup(r.backupDir)
  assert.strictEqual(v.ok, true, v.errors.join('; '))
  assert.strictEqual(v.status, 'complete')
  return { row: a, backupDir: r.backupDir }
})

test('backup: incomplete succeeds when confirmed; fail when unexpected', async () => {
  const x1 = addImageRow({ state: 'ok', withFile: false })
  const x2 = addImageRow({ state: 'ok', withFile: false })
  const before = backupService.listCompleteBackups(path.join(ROOT, 'backups')).length
  let r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'test', maxKeep: 3 })
  assert.strictEqual(r.ok, false)
  assert.ok(String(r.error).includes('missing referenced assets'))
  assert.strictEqual(backupService.listCompleteBackups(path.join(ROOT, 'backups')).length, before)
  db.confirmAssetMissing([x1.id, x2.id], '已确认丢失')
  r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'test', maxKeep: 3 })
  assert.strictEqual(r.ok, true, r.error)
  assert.strictEqual(r.manifest.assetState, 'incomplete')
  assert.ok(r.manifest.knownMissingAssets.length >= 2)
  assert.strictEqual(r.manifest.unexpectedMissingAssets.length, 0)
  const v = backupService.verifyBackup(r.backupDir)
  assert.strictEqual(v.ok, true, v.errors.join('; '))
  assert.strictEqual(v.status, 'consistent')
  assert.ok(v.knownMissing >= 2)
  db.revokeAssetMissing([x1.id])
  const before2 = backupService.listCompleteBackups(path.join(ROOT, 'backups')).length
  r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'test', maxKeep: 3 })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(backupService.listCompleteBackups(path.join(ROOT, 'backups')).length, before2)
})

test('restore staging accepts known missing and verify fails on unexpected', async () => {
  const list = backupService.listCompleteBackups(path.join(ROOT, 'backups'))
  const inc = list[0]
  assert.ok(inc)
  const prep = await backupService.prepareRestore({ backupDir: inc.dir, userData: ROOT, backupRoot: path.join(ROOT, 'backups') })
  assert.strictEqual(prep.ok, true, prep.error)
  try { fs.rmSync(prep.stagingDir, { recursive: true, force: true }) } catch {}
  // complete 备份被删一张图 → verify FAIL unexpected
  const complete = list.find(b => b.name.includes('complete')) || list[list.length - 1]
  const m = JSON.parse(fs.readFileSync(path.join(complete.dir, 'manifest.json'), 'utf8'))
  if (m.images.length) {
    const img = m.images[0]
    fs.unlinkSync(path.join(complete.dir, 'images', img.path))
    const v = backupService.verifyBackup(complete.dir)
    assert.strictEqual(v.ok, false)
    assert.ok(v.errors.some(e => e.includes('image missing')) || v.unexpectedMissing >= 1)
  }
})

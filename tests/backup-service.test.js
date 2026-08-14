const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('../node_modules/better-sqlite3')

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-backup-'))
for (const d of ['images/full', 'images/thumb', 'images/annotated']) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true })
}
process.env.CLIPBOARD_SHELF_TEST_ROOT = ROOT

const db = require('../src/main/services/db-service.js')
const backupService = require('../src/main/services/backup-service.js')

async function seed() {
  const now = Date.now()
  db.insert({ type: 'text', content: 'hello', createTime: now })
  const full = path.join(ROOT, 'images/full/f1.png')
  const thumb = path.join(ROOT, 'images/thumb/f1.jpg')
  fs.writeFileSync(full, 'FULL1')
  fs.writeFileSync(thumb, 'THUMB1')
  const item = db.insert({ type: 'image', content: 'f1.png', filePath: full, thumbPath: thumb, createTime: now })
  const ann = path.join(ROOT, 'images/annotated/f1_ann.png')
  fs.writeFileSync(ann, 'ANN1')
  db.setItemAnnotatedPath(item.id, ann)
}

test.before(async () => {
  await db.init()
  await seed()
})

test.after(() => {
  db.close()
  try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {}
})

test('complete backup succeeds with db+config+images+manifest', async () => {
  const r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'test', maxKeep: 3 })
  assert.strictEqual(r.ok, true, r.error)
  assert.ok(fs.existsSync(path.join(r.backupDir, 'manifest.json')))
  assert.ok(fs.existsSync(path.join(r.backupDir, 'shelf.db')))
  assert.ok(fs.existsSync(path.join(r.backupDir, 'images/full/f1.png')))
  assert.ok(fs.existsSync(path.join(r.backupDir, 'images/thumb/f1.jpg')))
  assert.ok(fs.existsSync(path.join(r.backupDir, 'images/annotated/f1_ann.png')))
  const v = backupService.verifyBackup(r.backupDir)
  assert.strictEqual(v.ok, true, v.errors.join('; '))
})

test('verify detects tampered image', async () => {
  const r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'test', maxKeep: 3 })
  fs.appendFileSync(path.join(r.backupDir, 'images/full/f1.png'), 'TAMPER')
  const v = backupService.verifyBackup(r.backupDir)
  assert.strictEqual(v.ok, false)
  assert.ok(v.errors.some(e => e.includes('image hash mismatch')))
})

test('missing referenced asset fails backup without new success dir', async () => {
  const full = path.join(ROOT, 'images/full/f1.png')
  fs.renameSync(full, full + '.hidden')
  const before = backupService.listCompleteBackups(path.join(ROOT, 'backups')).length
  const r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'test', maxKeep: 3 })
  assert.strictEqual(r.ok, false)
  assert.ok(String(r.error).includes('missing'))
  assert.strictEqual(backupService.listCompleteBackups(path.join(ROOT, 'backups')).length, before)
  fs.renameSync(full + '.hidden', full)
})

test('prune keeps maxKeep after successful backups', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'test', maxKeep: 2 })
    assert.strictEqual(r.ok, true, r.error)
  }
  assert.ok(backupService.listCompleteBackups(path.join(ROOT, 'backups')).length <= 2)
})

test('restore pipeline: staging, swap, auto rollback on corruption', async () => {
  const latest = backupService.listCompleteBackups(path.join(ROOT, 'backups'))[0]
  assert.ok(latest)
  const prep = await backupService.prepareRestore({ backupDir: latest.dir, userData: ROOT, backupRoot: path.join(ROOT, 'backups') })
  assert.strictEqual(prep.ok, true, prep.error)
  assert.ok(fs.existsSync(prep.stagingDir))
  assert.ok(fs.existsSync(prep.rollbackDir))

  db.close()
  const swap = backupService.swapRestore({ userData: ROOT, stagingDir: prep.stagingDir, rollbackDir: prep.rollbackDir })
  assert.strictEqual(swap.ok, true, swap.error)
  assert.ok(fs.existsSync(path.join(ROOT, 'restore-pending.json')))

  // 损坏恢复后的 DB → 启动检查应回滚
  fs.writeFileSync(path.join(ROOT, 'shelf.db'), 'broken')
  const rb = backupService.applyRollbackIfNeeded({ userData: ROOT })
  assert.strictEqual(rb.rolledBack, true)
  const check = new Database(path.join(ROOT, 'shelf.db'), { readonly: true })
  const n = check.prepare('SELECT COUNT(*) c FROM items').get().c
  check.close()
  assert.ok(n >= 1)
})

test('restore pipeline: success path clears marker and keeps data', async () => {
  await db.init()
  const r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'test', maxKeep: 3 })
  assert.strictEqual(r.ok, true, r.error)
  const prep = await backupService.prepareRestore({ backupDir: r.backupDir, userData: ROOT, backupRoot: path.join(ROOT, 'backups') })
  assert.strictEqual(prep.ok, true, prep.error)
  db.close()
  const swap = backupService.swapRestore({ userData: ROOT, stagingDir: prep.stagingDir, rollbackDir: prep.rollbackDir })
  assert.strictEqual(swap.ok, true, swap.error)
  const rb = backupService.applyRollbackIfNeeded({ userData: ROOT })
  assert.strictEqual(rb.rolledBack, false)
  assert.ok(!fs.existsSync(path.join(ROOT, 'restore-pending.json')))
  const check = new Database(path.join(ROOT, 'shelf.db'), { readonly: true })
  assert.strictEqual(check.prepare('SELECT COUNT(*) c FROM items').get().c >= 1, true)
  check.close()
})

test('main entry: backupService require precedes startup rollback check (TDZ guard)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8')
  const requireIdx = src.indexOf("require('./services/backup-service')")
  const useIdx = src.indexOf('applyRollbackIfNeeded')
  assert.ok(requireIdx >= 0, 'backupService require must exist in main entry')
  assert.ok(useIdx >= 0, 'applyRollbackIfNeeded must be referenced in main entry')
  assert.ok(
    requireIdx < useIdx,
    'backupService must be required before applyRollbackIfNeeded is invoked, otherwise startup check throws TDZ ReferenceError'
  )
})

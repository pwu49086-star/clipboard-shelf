const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bench-'))
for (const d of ['images/full', 'images/thumb', 'images/annotated']) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true })
}
process.env.CLIPBOARD_SHELF_TEST_ROOT = ROOT
const db = require('../src/main/services/db-service.js')
const backupService = require('../src/main/services/backup-service.js')

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {}
})

function seedImages(n) {
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    const full = path.join(ROOT, 'images/full', `b${i}.png`)
    const thumb = path.join(ROOT, 'images/thumb', `b${i}.jpg`)
    fs.writeFileSync(full, 'x'.repeat(1024 + i))
    fs.writeFileSync(thumb, 'y'.repeat(512))
    db.insert({ type: 'image', content: `b${i}.png`, filePath: full, thumbPath: thumb, createTime: now - i })
  }
}

test('benchmark: complete backup with 100 images', async () => {
  seedImages(100)
  const t0 = Date.now()
  const r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'bench', maxKeep: 1 })
  const elapsed = Date.now() - t0
  assert.strictEqual(r.ok, true, r.error)
  assert.ok(elapsed < 10000, `backup too slow: ${elapsed}ms`)
  console.log(`[backup-bench] 100 images: ${elapsed}ms size=${backupService.dirSize(r.backupDir)}`)
})

test('benchmark: complete backup with 500 images', async () => {
  seedImages(400) // 100 + 400 = 500
  const t0 = Date.now()
  const r = await backupService.createCompleteBackup({ backupRoot: path.join(ROOT, 'backups'), userData: ROOT, appVersion: 'bench', maxKeep: 1 })
  const elapsed = Date.now() - t0
  assert.strictEqual(r.ok, true, r.error)
  assert.ok(elapsed < 20000, `backup too slow: ${elapsed}ms`)
  console.log(`[backup-bench] 500 images: ${elapsed}ms size=${backupService.dirSize(r.backupDir)}`)
})

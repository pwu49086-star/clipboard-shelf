const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('../node_modules/better-sqlite3')
const integrity = require('../src/main/services/asset-integrity.js')

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-integrity-'))
  for (const d of ['images/full', 'images/thumb', 'images/annotated']) {
    fs.mkdirSync(path.join(root, d), { recursive: true })
  }
  const db = new Database(path.join(root, 'shelf.db'))
  db.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, type TEXT, filePath TEXT, thumbPath TEXT, annotatedPath TEXT)`)
  const ins = db.prepare('INSERT INTO items (id, type, filePath, thumbPath, annotatedPath) VALUES (?,?,?,?,?)')
  const mk = (kind, name) => {
    const p = path.join(root, 'images', kind, name)
    fs.writeFileSync(p, name)
    return p
  }
  const fullA = mk('full', 'a.png')
  const thumbA = mk('thumb', 'a.jpg')
  const fullB = mk('full', 'b.png')
  const annB = mk('annotated', 'b_ann.png')
  ins.run(1, 'image', fullA, thumbA, null)
  ins.run(2, 'image', fullB, null, annB)
  // 行 3：文件缺失（MISSING_FILE）
  ins.run(3, 'image', path.join(root, 'images/full/missing.png'), null, null)
  // 行 4：annotatedPath 缺失（MISSING_ANNOTATED）
  ins.run(4, 'image', fullA, thumbA, path.join(root, 'images/annotated/missing_ann.png'))
  db.close()
  // 孤儿文件
  fs.writeFileSync(path.join(root, 'images/full/orphan.png'), 'orphan')
  fs.writeFileSync(path.join(root, 'images/annotated/orphan_ann.png'), 'orphan-ann')
  return root
}

test('asset integrity classifies missing/orphan/annotated cases', () => {
  const root = setup()
  const r = integrity.scan({ userData: root })
  assert.strictEqual(r.dbUnreadable, false)
  assert.strictEqual(r.summary.imageRows, 4)
  assert.strictEqual(r.summary.fullMissing, 1)
  assert.strictEqual(r.summary.annotatedMissing, 1)
  assert.strictEqual(r.summary.orphanFull, 1)
  assert.strictEqual(r.summary.orphanAnnotated, 1)
  assert.ok(r.lists.missingFiles.some(x => x.itemId === 3 && x.kind === 'full'))
  assert.ok(r.lists.missingAnnotated.some(x => x.itemId === 4))
  assert.ok(r.lists.orphanFiles.some(x => x.file === 'orphan.png'))
  assert.ok(r.lists.orphanAnnotated.some(x => x.file === 'orphan_ann.png'))
  fs.rmSync(root, { recursive: true, force: true })
})

test('asset integrity reports dbUnreadable on broken db', () => {
  const root = setup()
  fs.writeFileSync(path.join(root, 'shelf.db'), 'not a database')
  const r = integrity.scan({ userData: root })
  assert.strictEqual(r.dbUnreadable, true)
  fs.rmSync(root, { recursive: true, force: true })
})

test('asset integrity hash mismatch with baseline manifest', () => {
  const root = setup()
  const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-integrity-base-'))
  fs.mkdirSync(path.join(baselineDir, 'images/full'), { recursive: true })
  // 基线 manifest：把 a.png 的 sha256 记为“另一个值”，制造 HASH_MISMATCH
  const baseline = {
    format: 'clipboard-shelf-backup',
    version: 1,
    createdAt: Date.now(),
    appVersion: 'x',
    schemaVersion: 4,
    db: { file: 'shelf.db', sha256: '0'.repeat(64), size: 1 },
    extra: [],
    images: [
      { path: 'full/a.png', itemId: 1, size: fs.statSync(path.join(root, 'images/full/a.png')).size, mtime: 1, sha256: 'f'.repeat(64) }
    ],
    counts: {},
    success: true
  }
  fs.writeFileSync(path.join(baselineDir, 'manifest.json'), JSON.stringify(baseline))
  const r = integrity.scan({ userData: root, baseline: baselineDir })
  assert.strictEqual(r.summary.hashMismatch, 1)
  assert.strictEqual(r.lists.hashMismatch.length, 1)
  fs.rmSync(baselineDir, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

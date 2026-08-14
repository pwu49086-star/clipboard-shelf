const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('../node_modules/better-sqlite3')
const integrity = require('../src/main/services/asset-integrity.js')

function makeRoot(n) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bench-integrity-'))
  fs.mkdirSync(path.join(root, 'images/full'), { recursive: true })
  const db = new Database(path.join(root, 'shelf.db'))
  db.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, type TEXT, filePath TEXT, thumbPath TEXT, annotatedPath TEXT, assetState TEXT, ocrText TEXT, assetMissingNote TEXT)`)
  const ins = db.prepare('INSERT INTO items (id, type, filePath, assetState) VALUES (?, ?, ?, ?)')
  const fullDir = path.join(root, 'images/full')
  for (let i = 0; i < n; i++) {
    const p = path.join(fullDir, `x${i}.png`)
    ins.run(i + 1, 'image', p, 'ok')
  }
  db.close()
  return root
}

for (const n of [200, 1000, 5000]) {
  test(`integrity scan benchmark: ${n} image rows`, () => {
    const root = makeRoot(n)
    const t0 = process.hrtime.bigint()
    const r = integrity.scan({ userData: root })
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    assert.strictEqual(r.summary.unexpectedMissing, n)
    assert.ok(ms < 5000, `scan too slow: ${ms}ms`)
    console.log(`[asset-integrity-bench] ${n} rows: ${ms.toFixed(1)}ms`)
    fs.rmSync(root, { recursive: true, force: true })
  })
}

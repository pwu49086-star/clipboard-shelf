const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const m = require('../src/shared/backup-manifest.cjs')

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs-manifest-'))
}

test('manifest build/write/read/verify roundtrip', () => {
  const dir = tmpdir()
  const dbAbs = path.join(dir, 'shelf.db')
  fs.writeFileSync(dbAbs, 'db-bytes')
  fs.mkdirSync(path.join(dir, 'images/full'), { recursive: true })
  const imgAbs = path.join(dir, 'images/full/a.png')
  fs.writeFileSync(imgAbs, 'img-bytes')
  const extraAbs = path.join(dir, 'config.json')
  fs.writeFileSync(extraAbs, '{}')

  const manifest = m.buildManifest({
    appVersion: '1.9.0',
    schemaVersion: 4,
    dbAbs,
    extras: [{ file: 'config.json', abs: extraAbs }],
    images: [{ path: 'full/a.png', itemId: 7, abs: imgAbs }],
    counts: { items: 1, images: 1 }
  })
  m.writeManifest(dir, manifest)
  const v = m.verifyManifest(dir)
  assert.strictEqual(v.ok, true, v.errors.join('; '))
  assert.strictEqual(m.readManifest(dir).counts.items, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('manifest detects hash mismatch and missing file', () => {
  const dir = tmpdir()
  const dbAbs = path.join(dir, 'shelf.db')
  fs.writeFileSync(dbAbs, 'db-bytes')
  const manifest = m.buildManifest({ appVersion: 'x', schemaVersion: 4, dbAbs, extras: [], images: [], counts: {} })
  m.writeManifest(dir, manifest)
  fs.appendFileSync(dbAbs, 'tampered')
  const v = m.verifyManifest(dir)
  assert.strictEqual(v.ok, false)
  assert.ok(v.errors.some(e => e.includes('db hash mismatch')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('manifest is privacy-minimized: forbidden keys rejected', () => {
  const bad = { format: 'clipboard-shelf-backup', content: 'secret', images: [{ path: 'full/a.png', itemId: 1, value: 'x' }] }
  const p = m.assertPrivacySafe(bad)
  assert.strictEqual(p.ok, false)
  assert.ok(p.found.includes('content'))
  assert.ok(p.found.includes('value'))
  const good = m.buildManifest({ appVersion: 'x', schemaVersion: 4, dbAbs: __filename, extras: [], images: [], counts: {} })
  assert.strictEqual(m.assertPrivacySafe(good).ok, true)
})

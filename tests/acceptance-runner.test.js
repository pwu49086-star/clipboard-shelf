const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const BASE = 'E:\\clipboard-shelf-acceptance'
const RUNNER = path.resolve(__dirname, '../scripts/acceptance-runner.cjs')

test('runner prepare creates TEST_ROOT + fingerprint and clean removes it', () => {
  const root = path.join(BASE, 'tests-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6))
  const out = execFileSync(process.execPath, [RUNNER, 'prepare', '--root', root], { encoding: 'utf8' })
  const parsed = JSON.parse(out)
  assert.strictEqual(parsed.testRoot, root)
  assert.ok(fs.existsSync(path.join(root, 'images/full')))
  assert.ok(fs.existsSync(path.join(root, 'backups/acceptance-fingerprint.json')))
  execFileSync(process.execPath, [RUNNER, 'clean', '--root', root], { encoding: 'utf8' })
  assert.ok(!fs.existsSync(root))
})

test('runner rejects TEST_ROOT outside acceptance base', () => {
  const root = path.join(os.tmpdir(), 'cs-bad-root-' + Date.now())
  assert.throws(() => execFileSync(process.execPath, [RUNNER, 'prepare', '--root', root], { encoding: 'utf8' }))
})

test('CLIPBOARD_SHELF_USER_DATA ignored outside test mode (no brain split)', async () => {
  const fake = path.join(os.tmpdir(), 'cs-fake-userdata-' + Date.now())
  process.env.CLIPBOARD_SHELF_USER_DATA = fake
  delete process.env.CLIPBOARD_SHELF_TEST_ROOT
  const db = require('../src/main/services/db-service.js')
  await db.init()
  db.close()
  assert.ok(!fs.existsSync(path.join(fake, 'shelf.db')))
  // node 环境下回退到 os.tmpdir()/clipboard-shelf
  const fallback = path.join(os.tmpdir(), 'clipboard-shelf', 'shelf.db')
  assert.ok(fs.existsSync(fallback))
  try { fs.rmSync(path.join(os.tmpdir(), 'clipboard-shelf'), { recursive: true, force: true }) } catch {}
  try { fs.rmSync(fake, { recursive: true, force: true }) } catch {}
})

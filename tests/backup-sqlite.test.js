const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('../node_modules/better-sqlite3')

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs-sqlite-'))
}

test('online backup includes uncheckpointed WAL transactions', async () => {
  const dir = tmpdir()
  const dbPath = path.join(dir, 'live.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
  db.prepare('INSERT INTO t (v) VALUES (?)').run('before')
  db.prepare('INSERT INTO t (v) VALUES (?)').run('after-wal')
  // 不 checkpoint，直接在线备份
  const dest = path.join(dir, 'backup.db')
  await db.backup(dest)
  const check = new Database(dest, { readonly: true })
  assert.strictEqual(check.prepare('SELECT COUNT(*) c FROM t').get().c, 2)
  assert.strictEqual(check.pragma('integrity_check', { simple: true }), 'ok')
  check.close()
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('backup corruption is detected by integrity_check', () => {
  const dir = tmpdir()
  const dbPath = path.join(dir, 'x.db')
  const db = new Database(dbPath)
  db.exec('CREATE TABLE t (v TEXT)')
  db.prepare('INSERT INTO t VALUES (?)').run('x')
  db.close()
  const buf = fs.readFileSync(dbPath)
  buf[100] = ~buf[100]
  fs.writeFileSync(dbPath, buf)
  let ic = null
  let threw = false
  try {
    const check = new Database(dbPath, { readonly: true })
    try {
      ic = check.pragma('integrity_check', { simple: true })
    } finally {
      check.close()
    }
  } catch {
    threw = true
  }
  assert.ok(threw || ic !== 'ok')
  fs.rmSync(dir, { recursive: true, force: true })
})

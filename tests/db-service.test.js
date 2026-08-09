const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const userData = path.join(os.tmpdir(), `clipboard-shelf-db-test-${Date.now()}`)
fs.mkdirSync(userData, { recursive: true })
process.env.CLIPBOARD_SHELF_USER_DATA = userData

const db = require('../src/main/services/db-service.js')

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
})

test('insert and getAll basic', () => {
  const item = db.insert({ type: 'text', content: 'hello clipboard', createTime: Date.now() })
  assert.ok(item.id > 0)
  const all = db.getAll({ limit: 50 })
  assert.ok(all.some(i => i.content === 'hello clipboard'))
})

test('search escapes percent and underscore', () => {
  db.insert({ type: 'text', content: 'abc100%def', createTime: Date.now() })
  db.insert({ type: 'text', content: 'abc100xdef', createTime: Date.now() })
  const hits = db.getAll({ search: '100%', limit: 10 })
  assert.ok(hits.some(i => i.content === 'abc100%def'))
  assert.ok(!hits.some(i => i.content === 'abc100xdef'))
})

test('toggleFavorite flips and sorts first', () => {
  const item = db.insert({ type: 'text', content: 'fav-me', createTime: Date.now() })
  const updated = db.toggleFavorite(item.id)
  assert.strictEqual(updated.isFavorite, 1)
  const all = db.getAll({ limit: 10 })
  assert.strictEqual(all[0].isFavorite, 1)
  db.toggleFavorite(item.id)
})

test('notes create/update/remind flow', () => {
  const note = db.insertNote({ title: 'remind me', content: '内容', color: '#fff' })
  const remindAt = Date.now() + 1000
  db.updateNote(note.id, { remindAt })
  const due = db.getDueReminders(Date.now() + 2000)
  assert.ok(due.some(n => n.id === note.id))
  db.markNoteReminded(note.id)
  const due2 = db.getDueReminders(Date.now() + 2000)
  assert.ok(!due2.some(n => n.id === note.id))
})

test('clearNonFavorites keeps favorites', () => {
  const fav = db.insert({ type: 'text', content: 'keep-me', createTime: Date.now() })
  db.toggleFavorite(fav.id)
  db.insert({ type: 'text', content: 'delete-me', createTime: Date.now() })
  db.clearNonFavorites()
  const all = db.getAll({ limit: 100 })
  assert.ok(all.some(i => i.id === fav.id))
  assert.ok(!all.some(i => i.content === 'delete-me'))
})

test('cleanOld trims oldest non-favorites', () => {
  for (let i = 0; i < 3; i++) {
    db.insert({ type: 'text', content: `old-${i}-${Date.now()}`, createTime: Date.now() - (3 - i) * 1000 })
  }
  const before = db.getAll({ limit: 1000 }).length
  const deleted = db.cleanOld(Math.max(1, before - 1))
  assert.ok(deleted.length >= 1)
  const after = db.getAll({ limit: 1000 }).length
  assert.ok(after < before)
})

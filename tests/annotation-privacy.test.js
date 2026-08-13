const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { canAnnotate } = require('../src/shared/annotation-gate.cjs')

const IMAGE = { id: 1, type: 'image', metadataOnly: 0, sensitivity: 0 }
const unlocked = { isEnabled: () => true, isUnlocked: () => true }
const locked = { isEnabled: () => true, isUnlocked: () => false }
const disabled = { isEnabled: () => false, isUnlocked: () => true }

test('normal image with encryption disabled passes gate', () => {
  assert.deepStrictEqual(canAnnotate(IMAGE, disabled), { ok: true })
})

test('unlocked encryption passes gate', () => {
  assert.deepStrictEqual(canAnnotate(IMAGE, unlocked), { ok: true })
})

test('metadataOnly=1 rejected', () => {
  const r = canAnnotate({ ...IMAGE, metadataOnly: 1 }, disabled)
  assert.strictEqual(r.ok, false)
  assert.ok(r.error)
})

test('sensitivity 1 rejected', () => {
  assert.strictEqual(canAnnotate({ ...IMAGE, sensitivity: 1 }, disabled).ok, false)
})

test('sensitivity 2 rejected', () => {
  assert.strictEqual(canAnnotate({ ...IMAGE, sensitivity: 2 }, disabled).ok, false)
})

test('non-image rejected', () => {
  assert.strictEqual(canAnnotate({ id: 2, type: 'text', sensitivity: 0 }, disabled).ok, false)
})

test('encryption locked rejected', () => {
  const r = canAnnotate(IMAGE, locked)
  assert.strictEqual(r.ok, false)
  assert.ok(r.error)
})

test('IPC smoke: annotations:save handler must call canAnnotate gate', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc-handlers.js'), 'utf8')
  assert.ok(src.includes("ipcMain.handle('annotations:save'"))
  assert.ok(src.includes('annotation-gate.cjs'))
  assert.ok(src.includes('canAnnotate(item, encryption)'))
})

test('IPC smoke: delete handlers must unlink annotatedPath (delete linkage regression)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc-handlers.js'), 'utf8')
  const unlinkCount = (src.match(/if \(item\.annotatedPath\) try \{ fs\.unlinkSync\(item\.annotatedPath\) \} catch \{\}/g) || []).length
  assert.ok(src.includes("ipcMain.handle('items:delete'"))
  assert.ok(src.includes("ipcMain.handle('items:batchDelete'"))
  assert.ok(unlinkCount >= 2, `annotatedPath must be unlinked in both delete handlers, got ${unlinkCount}`)
})

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const stateFile = path.join(os.tmpdir(), `pet-tasks-test-${Date.now()}.json`)
process.env.PET_TASKS_FILE = stateFile

const petTasks = require('../src/main/pet-tasks.js')

test('fresh state starts with default skin only', () => {
  const st = petTasks.getState()
  assert.deepStrictEqual(st.unlocked, ['default'])
  assert.strictEqual(st.points, 0)
})

test('copy task completes after 5 copies and unlocks snow skin', () => {
  let st
  for (let i = 0; i < 5; i++) st = petTasks.bump('copy')
  assert.strictEqual(st.done.copy5, true)
  assert.ok(st.unlocked.includes('snow'))
  assert.strictEqual(st.points, 1)
})

test('other tasks unlock their skins', () => {
  petTasks.bump('ocr')
  petTasks.bump('screenshot')
  petTasks.bump('favorite')
  petTasks.bump('palette')
  const st = petTasks.getState()
  assert.ok(st.unlocked.includes('gold'))
  assert.ok(st.unlocked.includes('mint'))
  assert.ok(st.unlocked.includes('lava'))
  assert.ok(st.unlocked.includes('nebula'))
  assert.strictEqual(st.points, 5)
})

test('completed tasks do not double count', () => {
  const before = petTasks.getState().points
  petTasks.bump('copy')
  const after = petTasks.getState().points
  assert.strictEqual(before, after)
})

test('persists to file', () => {
  assert.ok(fs.existsSync(stateFile))
  const raw = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
  assert.strictEqual(raw.points, 5)
})

test.after(() => {
  try { fs.unlinkSync(stateFile) } catch {}
})

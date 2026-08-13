const test = require('node:test')
const assert = require('node:assert')
const { createStore, fromJSON } = require('../src/shared/annotation-store.cjs')

test('single step undo/redo', () => {
  const s = createStore()
  s.add({ id: 'a', kind: 'rect', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
  assert.strictEqual(s.getElements().length, 1)
  assert.ok(s.undo())
  assert.strictEqual(s.getElements().length, 0)
  assert.ok(s.redo())
  assert.strictEqual(s.getElements().length, 1)
})

test('multi step undo/redo and new op clears future', () => {
  const s = createStore()
  s.add({ id: 'a', kind: 'rect', points: [] })
  s.add({ id: 'b', kind: 'arrow', points: [] })
  s.undo()
  s.undo()
  assert.strictEqual(s.getElements().length, 0)
  s.redo()
  assert.strictEqual(s.getElements()[0].id, 'a')
  s.add({ id: 'c', kind: 'text', points: [] })
  assert.ok(!s.canRedo(), 'new op must clear future')
})

test('mosaic flatten: undo disabled to before mosaic, future cleared', () => {
  const s = createStore()
  s.add({ id: 'a', kind: 'rect', points: [] })
  s.add({ id: 'm', kind: 'mosaic', points: [] })
  assert.ok(s.isMosaicLocked())
  assert.ok(!s.canUndo(), 'cannot undo to before mosaic')
  assert.ok(!s.canRedo(), 'future must be cleared')
  const m = s.getElements().find(e => e.id === 'm')
  assert.strictEqual(m.flattened, true)
})

test('post-mosaic elements can be undone, mosaic stays', () => {
  const s = createStore()
  s.add({ id: 'm', kind: 'mosaic', points: [] })
  s.add({ id: 'b', kind: 'rect', points: [] })
  assert.ok(s.canUndo())
  assert.ok(s.undo())
  const els = s.getElements()
  assert.strictEqual(els.length, 1)
  assert.strictEqual(els[0].kind, 'mosaic')
})

test('mosaic cannot be removed', () => {
  const s = createStore()
  s.add({ id: 'm', kind: 'mosaic', points: [] })
  assert.strictEqual(s.remove('m'), false)
  assert.strictEqual(s.getElements().length, 1)
})

test('fromJSON restores locked state and elements', () => {
  const doc = {
    v: 1,
    imageSize: { width: 100, height: 80 },
    elements: [
      { id: 'm', kind: 'mosaic', points: [], flattened: true },
      { id: 't', kind: 'text', points: [], text: 'ok' }
    ]
  }
  const s = fromJSON(doc)
  assert.ok(s.isMosaicLocked())
  assert.strictEqual(s.getElements().length, 2)
  const json = s.toJSON(doc.imageSize)
  assert.strictEqual(json.v, 1)
  assert.deepStrictEqual(json.imageSize, { width: 100, height: 80 })
})

test('mosaic + pen: undo/redo never reverts mosaic (P1 regression)', () => {
  const s = createStore()
  s.add({ id: 'm', kind: 'mosaic', points: [] })
  s.add({ id: 'p', kind: 'pen', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })
  assert.strictEqual(s.getElements().length, 2)
  assert.ok(s.undo(), 'pen after mosaic should be undoable')
  let els = s.getElements()
  assert.strictEqual(els.length, 1)
  assert.strictEqual(els[0].kind, 'mosaic')
  assert.ok(s.redo())
  els = s.getElements()
  assert.strictEqual(els.length, 2)
  assert.strictEqual(els[0].kind, 'mosaic')
  assert.strictEqual(els[1].kind, 'pen')
  assert.strictEqual(s.remove('m'), false, 'mosaic must never be removable')
})

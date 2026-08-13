const test = require('node:test')
const assert = require('node:assert')
const g = require('../src/shared/annotation-geometry.cjs')

const NATIVE = { width: 1920, height: 1080 }
const DISPLAY = { width: 960, height: 540 }

test('native ↔ display conversion roundtrip', () => {
  const p = { x: 480, y: 270 }
  const d = g.nativeToDisplay(p, NATIVE, DISPLAY)
  assert.deepStrictEqual(d, { x: 240, y: 135 })
  const back = g.displayToNative(d, NATIVE, DISPLAY)
  assert.deepStrictEqual(back, p)
})

test('2x zoom display point maps to half native', () => {
  const fit = g.fitRect(NATIVE, DISPLAY, 2, { x: 0, y: 0 })
  const n = g.displayPointToNative({ x: fit.x + 100, y: fit.y + 100 }, fit)
  assert.ok(Math.abs(n.x - 100) < 1e-6)
  assert.ok(Math.abs(n.y - 100) < 1e-6)
})

test('0.5x zoom and pan transform', () => {
  const fit = g.fitRect(NATIVE, DISPLAY, 0.5, { x: 30, y: -20 })
  const d = g.nativePointToDisplay({ x: 100, y: 100 }, fit)
  const back = g.displayPointToNative(d, fit)
  assert.ok(Math.abs(back.x - 100) < 1e-6)
  assert.ok(Math.abs(back.y - 100) < 1e-6)
})

test('mosaic blocks subdivide bounding rect', () => {
  const blocks = g.mosaicBlocks({
    kind: 'mosaic',
    points: [{ x: 0, y: 0 }, { x: 40, y: 40 }],
    blockSize: 16
  })
  assert.strictEqual(blocks.length, 9)
  assert.ok(blocks.every(b => b.w <= 16 && b.h <= 16))
})

test('buildDrawOps puts mosaic first and keeps native coords', () => {
  const { ops } = g.buildDrawOps([
    { kind: 'rect', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], color: '#e11', strokeWidth: 3 },
    { kind: 'mosaic', points: [{ x: 0, y: 0 }, { x: 32, y: 32 }], blockSize: 16 },
    { kind: 'text', points: [{ x: 5, y: 5 }], text: 'A', fontSize: 32, color: '#000' }
  ], NATIVE)
  assert.strictEqual(ops[0].op, 'mosaic')
  assert.strictEqual(ops[1].op, 'rect')
  assert.strictEqual(ops[2].op, 'text')
  const rect = ops[1]
  assert.deepStrictEqual([rect.x1, rect.y1, rect.x2, rect.y2], [10, 10, 20, 20])
})

test('hit test rect and text', () => {
  const rect = { kind: 'rect', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
  assert.ok(g.hitTestElement(rect, { x: 5, y: 5 }))
  assert.ok(!g.hitTestElement(rect, { x: 11, y: 5 }))
  const text = { kind: 'text', points: [{ x: 0, y: 10 }], text: 'AB', fontSize: 20 }
  assert.ok(g.hitTestElement(text, { x: 5, y: 9 }))
  assert.ok(!g.hitTestElement(text, { x: 5, y: 15 }))
})

test('export ops match editor coords (no zoom dependency)', () => {
  const el = { kind: 'arrow', points: [{ x: 100, y: 100 }, { x: 500, y: 400 }], color: '#1a5', strokeWidth: 5 }
  const { ops } = g.buildDrawOps([el], NATIVE)
  assert.deepStrictEqual([ops[0].x1, ops[0].y1, ops[0].x2, ops[0].y2], [100, 100, 500, 400])
})

test('pen replay op preserves native points (P1 regression)', () => {
  const pen = {
    kind: 'pen',
    points: [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }],
    color: '#e11',
    strokeWidth: 3
  }
  const ops = g.elementOps(pen)
  assert.strictEqual(ops.length, 1)
  assert.strictEqual(ops[0].op, 'path')
  assert.deepStrictEqual(ops[0].points, pen.points)
})

test('pen + rect + arrow + text mixed replay', () => {
  const { ops } = g.buildDrawOps([
    { kind: 'pen', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#e11', strokeWidth: 3 },
    { kind: 'rect', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], color: '#e11', strokeWidth: 3 },
    { kind: 'arrow', points: [{ x: 5, y: 5 }, { x: 9, y: 9 }], color: '#e11', strokeWidth: 3 },
    { kind: 'text', points: [{ x: 30, y: 30 }], text: 'A', fontSize: 32, color: '#000' }
  ], NATIVE)
  assert.deepStrictEqual(ops.map(o => o.op), ['path', 'rect', 'arrow', 'text'])
  assert.deepStrictEqual(ops[0].points, [{ x: 1, y: 2 }, { x: 3, y: 4 }])
})

test('mosaic + pen mixed replay keeps mosaic first', () => {
  const { ops } = g.buildDrawOps([
    { kind: 'pen', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#e11', strokeWidth: 3 },
    { kind: 'mosaic', points: [{ x: 0, y: 0 }, { x: 32, y: 32 }], blockSize: 16 }
  ], NATIVE)
  assert.strictEqual(ops[0].op, 'mosaic')
  assert.strictEqual(ops[1].op, 'path')
})

test('pen points survive 2x and 0.5x zoom roundtrip', () => {
  const pts = [{ x: 100, y: 100 }, { x: 300, y: 200 }]
  for (const zoom of [2, 0.5]) {
    const fit = g.fitRect(NATIVE, DISPLAY, zoom, { x: 0, y: 0 })
    const disp = pts.map(p => g.nativePointToDisplay(p, fit))
    const back = disp.map(p => g.displayPointToNative(p, fit))
    assert.ok(Math.abs(back[0].x - 100) < 1e-6)
    assert.ok(Math.abs(back[0].y - 100) < 1e-6)
    assert.ok(Math.abs(back[1].x - 300) < 1e-6)
    assert.ok(Math.abs(back[1].y - 200) < 1e-6)
  }
})

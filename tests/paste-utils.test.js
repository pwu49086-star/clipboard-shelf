const test = require('node:test')
const assert = require('node:assert')

const { numberedIndex, nextIndex, plainTextPayload } = require('../src/shared/paste-utils.cjs')

test('numberedIndex maps 1-9 to zero-based index', () => {
  assert.strictEqual(numberedIndex('1', 10), 0)
  assert.strictEqual(numberedIndex('5', 10), 4)
  assert.strictEqual(numberedIndex('9', 10), 8)
})

test('numberedIndex returns null when out of range', () => {
  assert.strictEqual(numberedIndex('0', 10), null)
  assert.strictEqual(numberedIndex('9', 5), null)
  assert.strictEqual(numberedIndex('9', 0), null)
  assert.strictEqual(numberedIndex('a', 10), null)
})

test('nextIndex advances to the next row and wraps', () => {
  assert.strictEqual(nextIndex(0, 5), 1)
  assert.strictEqual(nextIndex(3, 5), 4)
  assert.strictEqual(nextIndex(4, 5), 0)
})

test('nextIndex handles no selection and empty list', () => {
  assert.strictEqual(nextIndex(-1, 5), 0)
  assert.strictEqual(nextIndex(0, 0), null)
  assert.strictEqual(nextIndex(2, 0), null)
})

test('plainTextPayload only accepts text with content', () => {
  assert.deepStrictEqual(plainTextPayload({ type: 'text', content: 'hello' }), { type: 'text', content: 'hello' })
  assert.strictEqual(plainTextPayload({ type: 'image', content: 'a.png' }), null)
  assert.strictEqual(plainTextPayload({ type: 'text', content: '' }), null)
  assert.strictEqual(plainTextPayload({ type: 'text', content: null }), null)
  assert.strictEqual(plainTextPayload(null), null)
})

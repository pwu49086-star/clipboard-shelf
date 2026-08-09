const test = require('node:test')
const assert = require('node:assert')

const pipe = require('../src/main/services/clipboard-pipeline.js')
const { normalizeText, hashText } = pipe._test

test('normalizeText trims and normalizes line endings', () => {
  assert.strictEqual(normalizeText('  hello\r\nworld  '), 'hello\nworld')
  assert.strictEqual(normalizeText('a\rb'), 'a\nb')
  assert.strictEqual(normalizeText('  '), null)
})

test('normalizeText collapses repeated spaces', () => {
  assert.strictEqual(normalizeText('a  b   c'), 'a b c')
})

test('hashText is stable and differs for different content', () => {
  assert.strictEqual(hashText('abc'), hashText('abc'))
  assert.notStrictEqual(hashText('abc'), hashText('abd'))
})

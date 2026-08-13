const test = require('node:test')
const assert = require('node:assert')
const { resolveShelfFile } = require('../src/main/services/shelf-file.js')

const IMAGES = 'C:\\AppData\\clipboard-shelf\\images'

test('valid annotated file resolves', () => {
  const p = resolveShelfFile('shelf-file://annotated/12_1786400000000.png', IMAGES)
  assert.ok(p)
  assert.ok(p.endsWith('annotated\\12_1786400000000.png'))
})

test('valid thumb and full still resolve', () => {
  assert.ok(resolveShelfFile('shelf-file://thumb/a.png', IMAGES))
  assert.ok(resolveShelfFile('shelf-file://full/a.png', IMAGES))
})

test('parent traversal rejected', () => {
  assert.strictEqual(resolveShelfFile('shelf-file://thumb/..%2F..%2Fevil.png', IMAGES), null)
  assert.strictEqual(resolveShelfFile('shelf-file://full/../../evil.png', IMAGES), null)
})

test('non-whitelisted subdir rejected', () => {
  assert.strictEqual(resolveShelfFile('shelf-file://other/a.png', IMAGES), null)
  assert.strictEqual(resolveShelfFile('shelf-file://annotated2/a.png', IMAGES), null)
})

test('invalid annotated filename rejected', () => {
  assert.strictEqual(resolveShelfFile('shelf-file://annotated/evil.png', IMAGES), null)
  assert.strictEqual(resolveShelfFile('shelf-file://annotated/12_abc.png', IMAGES), null)
  assert.strictEqual(resolveShelfFile('shelf-file://annotated/12_1.png.png', IMAGES), null)
  assert.strictEqual(resolveShelfFile('shelf-file://annotated/', IMAGES), null)
})

test('empty url or dir rejected', () => {
  assert.strictEqual(resolveShelfFile('', IMAGES), null)
  assert.strictEqual(resolveShelfFile('shelf-file://full/a.png', ''), null)
})

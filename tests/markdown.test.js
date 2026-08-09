const test = require('node:test')
const assert = require('node:assert')
const { renderMarkdown } = require('../src/renderer/markdown.js')

test('escapes HTML', () => {
  const out = renderMarkdown('<script>alert(1)</script>')
  assert.ok(!out.includes('<script>'))
  assert.ok(out.includes('&lt;script&gt;'))
})

test('renders headings and bold/italic/code', () => {
  const out = renderMarkdown('# 标题\n\n**粗体** *斜体* `代码`')
  assert.ok(out.includes('<h1>标题</h1>'))
  assert.ok(out.includes('<strong>粗体</strong>'))
  assert.ok(out.includes('<em>斜体</em>'))
  assert.ok(out.includes('<code>代码</code>'))
})

test('renders lists and blockquote', () => {
  const out = renderMarkdown('- 甲\n- 乙\n\n1. 一\n2. 二\n\n> 引用')
  assert.ok(out.includes('<ul>'))
  assert.ok(out.includes('<ol>'))
  assert.ok(out.includes('<blockquote>引用</blockquote>'))
})

test('renders safe links only for http(s)', () => {
  const out = renderMarkdown('[官网](https://example.com) [坏链](javascript:alert(1))')
  assert.ok(out.includes('href="https://example.com"'))
  assert.ok(!out.includes('href="javascript:'))
})

test('empty input returns empty string', () => {
  assert.strictEqual(renderMarkdown(''), '')
  assert.strictEqual(renderMarkdown(null), '')
})

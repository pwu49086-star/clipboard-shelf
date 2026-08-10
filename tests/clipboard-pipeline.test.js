const test = require('node:test')
const assert = require('node:assert')

const pipe = require('../src/main/services/clipboard-pipeline.js')
const sourceCapture = require('../src/main/services/source-capture.js')
const { eventBus, Events } = require('../src/main/core/event-bus.js')
const { normalizeText, hashText, processItem, enqueue } = pipe._test

async function waitIdle(timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const s = pipe.getStatus()
    if (s.queueLength === 0 && !s.processing) return
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error('pipeline not idle')
}

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

test('worker uses detection-time snapshot even when queue is delayed (A → switch B)', async () => {
  let reCaptures = 0
  sourceCapture._test._setCaptureImpl(() => {
    reCaptures++
    return Promise.resolve({ app: 'notepad', process: 'notepad.exe', pid: 100 })
  })

  const seen = []
  const off = eventBus.on(Events.CLIPBOARD_TEXT, (item) => seen.push(item))

  // 模拟：A 复制后立即切到 B，worker 因上一条处理被延迟
  enqueue({
    type: 'text',
    content: 'from-notepad',
    capturedAt: Date.now(),
    sourcePromise: new Promise(r => setTimeout(() => r({ app: 'notepad', process: 'notepad.exe', pid: 100 }), 150))
  })
  enqueue({
    type: 'text',
    content: 'second-from-notepad',
    capturedAt: Date.now(),
    sourcePromise: Promise.resolve({ app: 'notepad', process: 'notepad.exe', pid: 100 })
  })

  await waitIdle()
  assert.strictEqual(seen.length, 2)
  assert.strictEqual(seen[0].sourceApp, 'notepad')
  assert.strictEqual(seen[1].sourceApp, 'notepad')
  assert.strictEqual(reCaptures, 0, 'worker must never re-capture foreground')
  off()
  sourceCapture._test._reset()
})

test('two consecutive copies keep their own snapshots (A1/A2 not polluted by B)', async () => {
  const seen = []
  const off = eventBus.on(Events.CLIPBOARD_TEXT, (item) => seen.push(item))

  enqueue({
    type: 'text',
    content: 'a1',
    capturedAt: Date.now(),
    sourcePromise: Promise.resolve({ app: 'wechat', process: 'wechat.exe', pid: 200 })
  })
  enqueue({
    type: 'text',
    content: 'a2',
    capturedAt: Date.now(),
    sourcePromise: Promise.resolve({ app: 'wechat', process: 'wechat.exe', pid: 200 })
  })

  await waitIdle()
  assert.strictEqual(seen.length, 2)
  assert.ok(seen.every(i => i.sourceApp === 'wechat'))
  off()
})

test('image-style worker block does not leak worker-window source to later items', async () => {
  const seen = []
  const off = eventBus.on(Events.CLIPBOARD_TEXT, (item) => seen.push(item))

  // 第一条模拟“图片处理”等慢任务（snapshot 解析很慢），第二条随后入队
  enqueue({
    type: 'text',
    content: 'slow-prev',
    capturedAt: Date.now(),
    sourcePromise: new Promise(r => setTimeout(() => r({ app: 'chrome', process: 'chrome.exe', pid: 300 }), 200))
  })
  enqueue({
    type: 'text',
    content: 'fast-next',
    capturedAt: Date.now(),
    sourcePromise: Promise.resolve({ app: 'ima.copilot', process: 'ima.copilot.exe', pid: 400 })
  })

  await waitIdle()
  assert.strictEqual(seen.length, 2)
  assert.strictEqual(seen[0].sourceApp, 'chrome')
  assert.strictEqual(seen[1].sourceApp, 'ima.copilot')
  off()
})

test('Clipboard Shelf own foreground is never recorded as electron', async () => {
  const seen = []
  const off = eventBus.on(Events.CLIPBOARD_TEXT, (item) => seen.push(item))

  await processItem({
    type: 'text',
    content: 'self-copy',
    capturedAt: Date.now(),
    sourcePromise: Promise.resolve({ app: 'electron', process: 'electron.exe', pid: 999 })
  })

  assert.strictEqual(seen.length, 1)
  assert.strictEqual(seen[0].sourceApp, null)
  assert.strictEqual(seen[0].sourceProcess, null)
  assert.strictEqual(seen[0].content, 'self-copy')
  off()
})

test('source capture failure still saves the record with null source', async () => {
  const seen = []
  const off = eventBus.on(Events.CLIPBOARD_TEXT, (item) => seen.push(item))

  await processItem({
    type: 'text',
    content: 'capture-failed',
    capturedAt: Date.now(),
    sourcePromise: Promise.resolve(null)
  })

  assert.strictEqual(seen.length, 1)
  assert.strictEqual(seen[0].sourceApp, null)
  assert.strictEqual(seen[0].content, 'capture-failed')
  off()
})

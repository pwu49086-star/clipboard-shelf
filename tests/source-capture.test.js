const test = require('node:test')
const assert = require('node:assert')

const {
  parseForegroundOutput,
  parseResultLine,
  isSelfSource,
  getForegroundSource,
  getStats,
  start,
  stop,
  _test
} = require('../src/main/services/source-capture.js')

// ====== fake transport ======
function createFakeTransport() {
  const handlers = { line: [], exit: [], error: [] }
  let killed = false
  const t = {
    written: [],
    onLine(cb) { handlers.line.push(cb) },
    onExit(cb) { handlers.exit.push(cb) },
    onError(cb) { handlers.error.push(cb) },
    write(line) { t.written.push(line) },
    kill() {
      if (!killed) {
        killed = true
        handlers.exit.slice().forEach(cb => cb(0, 'sigterm'))
      }
    },
    isAlive() { return !killed },
    emitLine(l) { handlers.line.slice().forEach(cb => cb(l)) },
    emitExit() {
      if (!killed) {
        killed = true
        handlers.exit.slice().forEach(cb => cb(0, 'eof'))
      }
    },
    fireExit() { handlers.exit.slice().forEach(cb => cb(0, 'stale')) },
    emitError(e) { handlers.error.slice().forEach(cb => cb(e || new Error('spawn error'))) }
  }
  return t
}

function makeFactory() {
  const instances = []
  return {
    factory: () => {
      const t = createFakeTransport()
      instances.push(t)
      return t
    },
    instances
  }
}

async function bootFake(factory, instances) {
  const boot = start()
  const inst = instances[instances.length - 1]
  if (!inst) throw new Error('transport not created')
  inst.emitLine('READY')
  assert.strictEqual(await boot, true)
  return inst
}

async function flush() {
  await new Promise(r => setTimeout(r, 0))
}

function lastQueryId(inst, index = -1) {
  const line = inst.written[index < 0 ? inst.written.length + index : index]
  return line ? line.slice(1) : '?'
}

// ====== parse ======
test('parses valid foreground output', () => {
  const r = parseForegroundOutput('chrome|1234\r\n')
  assert.deepStrictEqual(r, { app: 'chrome', process: 'chrome.exe', pid: 1234 })
})

test('returns null for empty output', () => {
  assert.strictEqual(parseForegroundOutput(''), null)
  assert.strictEqual(parseForegroundOutput(null), null)
})

test('returns null for malformed output', () => {
  assert.strictEqual(parseForegroundOutput('garbage'), null)
  assert.strictEqual(parseForegroundOutput('chrome'), null)
})

test('non-numeric pid is tolerated as null', () => {
  const r = parseForegroundOutput('wechat|abc')
  assert.strictEqual(r.app, 'wechat')
  assert.strictEqual(r.pid, null)
})

test('parseResultLine parses service response', () => {
  assert.deepStrictEqual(parseResultLine('RESULT|7|1234|notepad'), {
    id: 7, pid: 1234, app: 'notepad', process: 'notepad.exe'
  })
  assert.strictEqual(parseResultLine('RESULT|7|0|'), null)
  assert.strictEqual(parseResultLine('garbage'), null)
})

// ====== self filtering ======
test('isSelfSource detects Clipboard Shelf own window', () => {
  assert.strictEqual(isSelfSource({ app: 'electron', pid: 123 }), true)
  assert.strictEqual(isSelfSource({ app: 'clipboard shelf', pid: 123 }), true)
  assert.strictEqual(isSelfSource({ app: 'Clipboard Shelf 1.4.0', pid: 123 }), true)
  assert.strictEqual(isSelfSource({ app: 'notepad', pid: Number(process.pid) }), true)
  assert.strictEqual(isSelfSource({ app: 'notepad', pid: 999 }), false)
  assert.strictEqual(isSelfSource(null), false)
})

// ====== service: boot ======
test('persistent worker boots once on start()', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)

  const boot = start()
  assert.strictEqual(instances.length, 1)
  instances[0].emitLine('READY')
  assert.strictEqual(await boot, true)
  assert.strictEqual(getStats().ready, true)
  _test._reset()
})

// ====== service: warm queries ======
test('warm queries return independent fresh snapshots (A then B)', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)
  const inst = await bootFake(factory, instances)

  const p1 = getForegroundSource()
  await flush()
  assert.match(inst.written[0], /^Q\d+$/)
  inst.emitLine('RESULT|' + lastQueryId(inst, 0) + '|100|notepad')
  assert.deepStrictEqual(await p1, { app: 'notepad', process: 'notepad.exe', pid: 100 })

  const p2 = getForegroundSource()
  await flush()
  inst.emitLine('RESULT|' + lastQueryId(inst, 1) + '|200|chrome')
  assert.deepStrictEqual(await p2, { app: 'chrome', process: 'chrome.exe', pid: 200 })
  _test._reset()
})

test('concurrent queries are serialized and responses match by id', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)
  const inst = await bootFake(factory, instances)

  const p1 = getForegroundSource()
  const p2 = getForegroundSource()
  await flush()
  assert.strictEqual(inst.written.length, 1, 'second query must wait')

  inst.emitLine('RESULT|' + lastQueryId(inst, 0) + '|100|notepad')
  assert.deepStrictEqual(await p1, { app: 'notepad', process: 'notepad.exe', pid: 100 })

  await flush()
  inst.emitLine('RESULT|' + lastQueryId(inst, 1) + '|200|wechat')
  assert.deepStrictEqual(await p2, { app: 'wechat', process: 'wechat.exe', pid: 200 })
  _test._reset()
})

// ====== service: abnormal exit / EOF ======
test('abnormal exit mid-query returns null and recovers on next query', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)
  const inst = await bootFake(factory, instances)

  const p1 = getForegroundSource()
  await flush()
  inst.emitExit()
  assert.strictEqual(await p1, null)

  // 重启进行中：立即发起的请求返回 null，不阻塞
  const p2 = getForegroundSource()
  await flush()
  assert.strictEqual(instances.length, 2, 'worker must auto-restart')
  assert.strictEqual(await p2, null)

  const inst2 = await bootFake(factory, instances)
  assert.strictEqual(inst2, instances[1])
  const p3 = getForegroundSource()
  await flush()
  inst2.emitLine('RESULT|' + lastQueryId(inst2, 0) + '|300|ima.copilot')
  assert.deepStrictEqual(await p3, { app: 'ima.copilot', process: 'ima.copilot.exe', pid: 300 })
  assert.ok(getStats().restartCount >= 1)
  _test._reset()
})

test('stdout EOF is treated as worker down and does not block later queries', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)
  const inst = await bootFake(factory, instances)

  const p1 = getForegroundSource()
  await flush()
  inst.emitExit() // 模拟 EOF → close
  assert.strictEqual(await p1, null)

  const p2 = getForegroundSource()
  await flush()
  assert.strictEqual(instances.length, 2)
  assert.strictEqual(await p2, null)

  const inst2 = await bootFake(factory, instances)
  const p3 = getForegroundSource()
  await flush()
  inst2.emitLine('RESULT|' + lastQueryId(inst2, 0) + '|400|explorer')
  assert.deepStrictEqual(await p3, { app: 'explorer', process: 'explorer.exe', pid: 400 })
  _test._reset()
})

// ====== service: mismatch ======
test('mismatched response kills worker and recovers without A/B mixing', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)
  const inst = await bootFake(factory, instances)

  const p1 = getForegroundSource()
  await flush()
  inst.emitLine('RESULT|999|100|evil')
  assert.strictEqual(await p1, null)

  const p2 = getForegroundSource()
  await flush()
  assert.strictEqual(instances.length, 2)
  assert.strictEqual(await p2, null)

  const inst2 = await bootFake(factory, instances)
  const p3 = getForegroundSource()
  await flush()
  inst2.emitLine('RESULT|' + lastQueryId(inst2, 0) + '|500|notepad')
  assert.deepStrictEqual(await p3, { app: 'notepad', process: 'notepad.exe', pid: 500 })
  _test._reset()
})

test('stale worker exit cannot clobber the current worker', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)

  const inst1 = await bootFake(factory, instances)
  inst1.kill() // 当前 worker 退出

  const inst2 = await bootFake(factory, instances)
  assert.strictEqual(instances.length, 2)

  // 旧 worker 的退出事件“迟到”到达，不得影响新 worker
  inst1.fireExit()

  const p = getForegroundSource()
  await flush()
  inst2.emitLine('RESULT|' + lastQueryId(inst2, 0) + '|800|notepad')
  assert.deepStrictEqual(await p, { app: 'notepad', process: 'notepad.exe', pid: 800 })
  _test._reset()
})

// ====== service: timeout ======
test('query timeout resolves null and later queries still work', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)
  _test._setQueryTimeout(60)
  const inst = await bootFake(factory, instances)

  const p1 = getForegroundSource() // 不响应 → 超时
  await flush()
  assert.strictEqual(await p1, null)

  const p2 = getForegroundSource()
  await flush()
  assert.strictEqual(instances.length, 2, 'hung worker must be restarted')
  assert.strictEqual(await p2, null)

  const inst2 = await bootFake(factory, instances)
  const p3 = getForegroundSource()
  await flush()
  inst2.emitLine('RESULT|' + lastQueryId(inst2, 0) + '|600|chrome')
  assert.deepStrictEqual(await p3, { app: 'chrome', process: 'chrome.exe', pid: 600 })
  _test._reset()
})

// ====== service: ERROR line ======
test('ERROR response yields null but worker stays alive', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)
  const inst = await bootFake(factory, instances)

  const p1 = getForegroundSource()
  await flush()
  inst.emitLine('ERROR|boom')
  assert.strictEqual(await p1, null)

  const p2 = getForegroundSource()
  await flush()
  assert.strictEqual(instances.length, 1, 'non-fatal error must not restart')
  inst.emitLine('RESULT|' + lastQueryId(inst, 1) + '|700|wechat')
  assert.deepStrictEqual(await p2, { app: 'wechat', process: 'wechat.exe', pid: 700 })
  _test._reset()
})

// ====== service: self filtering ======
test('service returns null when foreground is Clipboard Shelf itself', async () => {
  _test._reset()
  const { factory, instances } = makeFactory()
  _test._setTransportFactory(factory)
  _test._setRestartCooldown(0)
  const inst = await bootFake(factory, instances)

  const p1 = getForegroundSource()
  await flush()
  inst.emitLine('RESULT|' + lastQueryId(inst, 0) + '|123|electron')
  assert.strictEqual(await p1, null)

  const p2 = getForegroundSource()
  await flush()
  inst.emitLine('RESULT|' + lastQueryId(inst, 1) + '|124|Clipboard Shelf')
  assert.strictEqual(await p2, null)
  _test._reset()
})

// ====== real PowerShell worker ======
test('real powershell service boots and answers warm queries', async () => {
  _test._reset()
  _test._setRestartCooldown(0)
  const t0 = Date.now()
  const ok = await Promise.race([
    start(),
    new Promise(r => setTimeout(() => r(false), 15000))
  ])
  assert.strictEqual(ok, true)
  const cold = Date.now() - t0

  const r = await Promise.race([
    getForegroundSource(),
    new Promise(r => setTimeout(() => r('timeout'), 5000))
  ])
  assert.ok(r === null || (r && typeof r.app === 'string'))

  const stats = getStats()
  console.log('[real-worker] coldStartMs=' + cold + ' stats=' + JSON.stringify(stats))
  stop()
  _test._reset()
})

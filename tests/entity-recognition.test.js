const test = require('node:test')
const assert = require('node:assert')

const {
  recognize,
  shouldPersist,
  PERSIST_TYPES,
  MEMORY_ONLY_TYPES
} = require('../src/main/services/entity-recognition.js')

function valuesOf(text, type) {
  return recognize(text).entities.filter(e => e.type === type).map(e => e.value)
}

function has(text, type, value) {
  return recognize(text).entities.some(e => e.type === type && e.value === value)
}

// ====== brand ======
test('recognizes HVAC brands with models', () => {
  assert.ok(has('大金 RXYQ16AYM U4', 'brand', '大金'))
  assert.ok(has('格力 GMV-450W 报 E6', 'brand', '格力'))
  assert.ok(has('美的 MDV-560W 故障 P0', 'brand', '美的'))
  assert.ok(has('日立 RAS-224FSDN', 'brand', '日立'))
  assert.ok(has('三菱 PUHY-P200YHM', 'brand', '三菱'))
  assert.ok(has('松下 CS-KS18KD', 'brand', '松下'))
  assert.ok(has('富士通将军 AOYG36LATT', 'brand', '富士通将军'))
})

test('recognizes brands by english alias', () => {
  assert.ok(has('Daikin RXYQ16AYM', 'brand', '大金'))
  assert.ok(has('Gree GMV-450W', 'brand', '格力'))
  assert.ok(has('fujitsu AOYG36LATT', 'brand', '富士通将军'))
})

// ====== model ======
test('recognizes models per brand (normalized)', () => {
  assert.deepStrictEqual(valuesOf('大金 RXYQ16AYM', 'model'), ['RXYQ16AYM'])
  assert.deepStrictEqual(valuesOf('格力 GMV-450W', 'model'), ['GMV450W'])
  assert.deepStrictEqual(valuesOf('美的 MDV-560W', 'model'), ['MDV560W'])
  assert.deepStrictEqual(valuesOf('日立 RAS-224FSDN', 'model'), ['RAS224FSDN'])
  assert.deepStrictEqual(valuesOf('三菱 PUHY-P200YHM', 'model'), ['PUHYP200YHM'])
  assert.deepStrictEqual(valuesOf('松下 CS-KS18KD', 'model'), ['CSKS18KD'])
  assert.deepStrictEqual(valuesOf('富士通将军 AOYG36LATT', 'model'), ['AOYG36LATT'])
})

// ====== fault_code ======
test('recognizes fault codes with context or brand anchor', () => {
  assert.ok(has('故障代码 E6', 'fault_code', 'E6'))
  assert.ok(has('大金 U4', 'fault_code', 'U4'))
  assert.ok(has('格力 E6', 'fault_code', 'E6'))
  assert.ok(has('P0 保护', 'fault_code', 'P0'))
  assert.ok(has('美的 MDV-560W P0', 'fault_code', 'P0'))
})

test('does not treat short standalone strings as fault codes', () => {
  assert.strictEqual(valuesOf('A1').length, 0)
  assert.strictEqual(valuesOf('B1').length, 0)
  assert.strictEqual(valuesOf('123').length, 0)
  assert.strictEqual(valuesOf('01').length, 0)
  assert.strictEqual(valuesOf('E').length, 0)
  assert.strictEqual(valuesOf('版本 v1.4.1').filter(e => e.type === 'fault_code').length, 0)
})

test('does not extract fault code from inside url', () => {
  const r = recognize('https://example.com/path?code=U4')
  assert.ok(r.entities.some(e => e.type === 'url'))
  assert.strictEqual(r.entities.filter(e => e.type === 'fault_code').length, 0)
})

// ====== refrigerant ======
test('recognizes refrigerants case-insensitively', () => {
  for (const r of ['R22', 'R410A', 'R32', 'R454B']) {
    assert.ok(has(`系统使用 ${r}`, 'refrigerant', r), r)
  }
  assert.ok(has('r410a 系统', 'refrigerant', 'R410A'))
})

// ====== url ======
test('recognizes url and trims trailing punctuation', () => {
  const urls = valuesOf('看这里 https://example.com/path?q=1。', 'url')
  assert.deepStrictEqual(urls, ['https://example.com/path?q=1'])
})

// ====== phone / email：仅内存识别，不持久化 ======
test('phone and email are memory-only (never persisted)', () => {
  const r = recognize('联系 13812345678 或 a@b.com')
  assert.ok(r.entities.some(e => e.type === 'phone' && e.value === '13812345678'))
  assert.ok(r.entities.some(e => e.type === 'email' && e.value === 'a@b.com'))
  assert.strictEqual(PERSIST_TYPES.has('phone'), false)
  assert.strictEqual(PERSIST_TYPES.has('email'), false)
  assert.ok(r.entities.filter(e => e.type === 'phone' || e.type === 'email').every(e => !shouldPersist(e)))
  assert.ok(MEMORY_ONLY_TYPES.has('phone') && MEMORY_ONLY_TYPES.has('email'))
})

// ====== 无实体 / 误报控制 ======
test('no-entity text returns empty', () => {
  assert.deepStrictEqual(recognize('今天天气不错，出去走走。').entities, [])
})

test('chinese brand without hvac context is rejected', () => {
  assert.strictEqual(valuesOf('美的很漂亮').length, 0)
})

test('version-like strings are not models', () => {
  const r = recognize('当前版本 v1.4.1，请更新')
  assert.strictEqual(r.entities.filter(e => e.type === 'model').length, 0)
})

// ====== 多实体 ======
test('multi-entity text extracts all types', () => {
  const r = recognize('大金 RXYQ16AYM U4 R410A https://a.com 13812345678 a@b.com')
  const types = new Set(r.entities.map(e => e.type))
  assert.ok(types.has('brand'))
  assert.ok(types.has('model'))
  assert.ok(types.has('fault_code'))
  assert.ok(types.has('refrigerant'))
  assert.ok(types.has('url'))
  assert.ok(types.has('phone'))
  assert.ok(types.has('email'))

  const persisted = r.entities.filter(shouldPersist).map(e => e.type)
  assert.ok(persisted.includes('brand'))
  assert.ok(persisted.includes('model'))
  assert.ok(persisted.includes('fault_code'))
  assert.ok(persisted.includes('refrigerant'))
  assert.ok(persisted.includes('url'))
  assert.ok(!persisted.includes('phone'))
  assert.ok(!persisted.includes('email'))
})

// ====== 超长文本截断 ======
test('long text is truncated before analysis', () => {
  const r1 = recognize('RXYQ16AYM ' + 'x'.repeat(12000))
  assert.strictEqual(r1.truncated, true)
  assert.ok(r1.entities.some(e => e.type === 'model' && e.value === 'RXYQ16AYM'))

  const r2 = recognize('x'.repeat(10050) + ' RXYQ16AYM')
  assert.strictEqual(r2.truncated, true)
  assert.strictEqual(r2.entities.filter(e => e.type === 'model').length, 0)
})

// ====== 性能：P95 < 20ms ======
test('entity recognition P95 < 20ms', () => {
  const samples = [
    '这是一段普通文本',
    '大金 RXYQ16AYM 多联机 U4 故障',
    '格力 GMV-450W 报 E6 代码',
    'r410a 系统制冷剂不足',
    'x'.repeat(10000),
    '大金 U4 R410A https://example.com 13812345678 a@b.com'
  ]
  const all = []
  for (const s of samples) {
    const times = []
    for (let i = 0; i < 30; i++) {
      const t0 = Date.now()
      recognize(s)
      times.push(Date.now() - t0)
    }
    all.push(...times)
  }
  const sorted = [...all].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  console.log('[entity-bench] samples=' + all.length + ' p95=' + p95 + 'ms max=' + sorted[sorted.length - 1] + 'ms')
  assert.ok(p95 < 20, 'P95 must be < 20ms, got ' + p95)
})

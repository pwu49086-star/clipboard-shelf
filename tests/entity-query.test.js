const test = require('node:test')
const assert = require('node:assert')

const {
  parseEntityQuery,
  filterLabel,
  filterToSearchText,
  stripFilterToken
} = require('../src/shared/entity-query.cjs')

test('parses chinese typed filters', () => {
  const r = parseEntityQuery('品牌:大金 故障:U4')
  assert.deepStrictEqual(r.entityFilters, [
    { type: 'brand', value: '大金', raw: '品牌:大金' },
    { type: 'fault_code', value: 'U4', raw: '故障:U4' }
  ])
  assert.deepStrictEqual(r.plain, [])
})

test('parses english typed filters and normalizes values', () => {
  const r = parseEntityQuery('model:gmv-450w refrigerant:r410a')
  assert.deepStrictEqual(r.entityFilters, [
    { type: 'model', value: 'GMV450W', raw: 'model:gmv-450w' },
    { type: 'refrigerant', value: 'R410A', raw: 'refrigerant:r410a' }
  ])
})

test('brand english alias resolves to canonical', () => {
  const r = parseEntityQuery('品牌:daikin')
  assert.strictEqual(r.entityFilters[0].value, '大金')
})

test('mixed plain and typed tokens', () => {
  const r = parseEntityQuery('R410A 泄漏 型号:RXYQ16AYM')
  assert.deepStrictEqual(r.plain, ['R410A', '泄漏'])
  assert.strictEqual(r.entityFilters.length, 1)
  assert.strictEqual(r.entityFilters[0].type, 'model')
  assert.strictEqual(r.entityFilters[0].value, 'RXYQ16AYM')
})

test('unknown prefix falls back to plain keyword', () => {
  const r = parseEntityQuery('颜色:红 大金')
  assert.deepStrictEqual(r.plain, ['颜色:红', '大金'])
  assert.deepStrictEqual(r.entityFilters, [])
})

test('empty filter value is ignored', () => {
  const r = parseEntityQuery('品牌: 型号:')
  assert.deepStrictEqual(r.entityFilters, [])
  assert.deepStrictEqual(r.plain, [])
})

test('full-width colon is supported', () => {
  const r = parseEntityQuery('品牌：格力')
  assert.strictEqual(r.entityFilters[0].value, '格力')
})

test('model filter is exact after normalization', () => {
  const r = parseEntityQuery('型号:RXYQ16AYM')
  assert.strictEqual(r.entityFilters[0].value, 'RXYQ16AYM')
})

test('filterLabel and filterToSearchText roundtrip', () => {
  const f = { type: 'fault_code', value: 'U4' }
  assert.strictEqual(filterLabel(f), '故障')
  assert.strictEqual(filterToSearchText(f), '故障:U4')
})

test('stripFilterToken removes the raw token', () => {
  const f = { type: 'brand', value: '大金', raw: '品牌:daikin' }
  assert.strictEqual(stripFilterToken('大金空调 品牌:daikin 故障:U4', f), '大金空调 故障:U4')
})

test('parse handles empty input', () => {
  const r = parseEntityQuery('')
  assert.deepStrictEqual(r.plain, [])
  assert.deepStrictEqual(r.entityFilters, [])
})

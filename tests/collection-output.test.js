const test = require('node:test')
const assert = require('node:assert')

const {
  buildPlainText,
  buildMarkdown,
  buildWorkOrderDraft
} = require('../src/shared/collection-output.cjs')

const textItem = (id, content, extra = {}) => ({ id, type: 'text', content, ...extra })
const imageItem = (id, content, ocrText = '') => ({ id, type: 'image', content, ocrText })

test('plain text preserves selection order', () => {
  const out = buildPlainText([textItem(1, 'A'), textItem(2, 'B'), textItem(3, 'C')])
  assert.strictEqual(out.text, 'A\n\nB\n\nC')
  assert.strictEqual(out.count, 3)
})

test('duplicate content is kept', () => {
  const out = buildPlainText([textItem(1, 'X'), textItem(2, 'X')])
  assert.strictEqual(out.text, 'X\n\nX')
  assert.strictEqual(out.count, 2)
})

test('sensitivity 0/1 output, 2/metadataOnly/null excluded', () => {
  const items = [
    textItem(1, 'normal', { sensitivity: 0 }),
    textItem(2, 'sensitive-ok', { sensitivity: 1 }),
    textItem(3, 'high', { sensitivity: 2 }),
    textItem(4, 'meta', { metadataOnly: 1 }),
    textItem(5, null)
  ]
  const out = buildPlainText(items)
  assert.strictEqual(out.text, 'normal\n\nsensitive-ok')
  assert.strictEqual(out.count, 2)
  assert.strictEqual(out.excluded, 3)
})

test('image with OCR outputs OCR text', () => {
  const out = buildPlainText([imageItem(1, 'IMG_1.png', '外机型号 RXYQ16AYM')])
  assert.strictEqual(out.text, '外机型号 RXYQ16AYM')
})

test('image without OCR uses filename placeholder, never a path', () => {
  const out = buildPlainText([imageItem(1, 'C:\\Users\\x\\AppData\\Roaming\\clipboard-shelf\\images\\full\\IMG_1.png')])
  assert.strictEqual(out.text, '[图片: IMG_1.png]')
  assert.ok(!out.text.includes('C:\\'))
  assert.ok(!out.text.includes('AppData'))
})

test('missing items are skipped and counted', () => {
  const out = buildPlainText([textItem(1, 'A'), null, textItem(3, 'C')])
  assert.strictEqual(out.text, 'A\n\nC')
  assert.strictEqual(out.count, 2)
  assert.strictEqual(out.skipped, 1)
})

test('empty selection produces no output', () => {
  const out = buildPlainText([])
  assert.strictEqual(out.text, '')
  assert.strictEqual(out.count, 0)
})

test('long text is preserved', () => {
  const long = 'x'.repeat(20000)
  const out = buildPlainText([textItem(1, long)])
  assert.strictEqual(out.text, long)
})

test('markdown has title and preserves order', () => {
  const out = buildMarkdown([textItem(1, 'A'), textItem(2, 'B')])
  assert.ok(out.text.startsWith('# 维修记录'))
  assert.ok(out.text.includes('A\n\nB'))
})

test('large batches 200/500 preserve order', () => {
  for (const n of [200, 500]) {
    const items = []
    for (let i = 1; i <= n; i++) items.push(textItem(i, `item-${i}`))
    const t0 = Date.now()
    const out = buildPlainText(items)
    const elapsed = Date.now() - t0
    assert.strictEqual(out.count, n)
    assert.ok(out.text.startsWith('item-1'))
    assert.ok(out.text.endsWith(`item-${n}`))
    assert.ok(elapsed < 500, `batch ${n} should be fast, got ${elapsed}ms`)
  }
})

test('work order draft groups facts without fabrication', () => {
  const items = [
    textItem(1, '大金 RXYQ16AYM', { entities: [
      { type: 'brand', value: '大金' },
      { type: 'model', value: 'RXYQ16AYM' }
    ] }),
    textItem(2, '故障代码 U4'),
    textItem(3, '检查通讯线'),
    imageItem(4, 'IMG_2.png', '外机主板')
  ]
  const out = buildWorkOrderDraft(items)
  assert.strictEqual(out.count, 4)
  assert.ok(out.text.includes('# 维修工单草稿'))
  assert.ok(out.text.includes('## 设备信息'))
  assert.ok(out.text.includes('品牌：大金'))
  assert.ok(out.text.includes('型号：RXYQ16AYM'))
  assert.ok(out.text.includes('## 故障现象'))
  assert.ok(out.text.includes('故障代码 U4'))
  assert.ok(out.text.includes('## 检测记录'))
  assert.ok(out.text.includes('检查通讯线'))
  assert.ok(out.text.includes('## 处理过程'))
  assert.ok(out.text.includes('## 备注'))
  assert.ok(out.text.includes('外机主板'))
  // 不得编造诊断/建议
  assert.ok(!out.text.includes('维修建议'))
  assert.ok(!out.text.includes('可能原因'))
  assert.ok(!out.text.includes('缺氟'))
  assert.ok(!out.text.includes('自动诊断'))
})

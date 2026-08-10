/**
 * Collection Output - 多选记录的纯文本 / Markdown / 工单草稿输出（纯逻辑）
 *
 * - 零 Electron / 零数据库依赖，可独立单测；
 * - 输出顺序 = 传入顺序（调用方按 selectedIds 的 Set 插入顺序重组）；
 * - 不修改原文，不做 AI 改写；
 * - 隐私：sensitivity=2 / metadataOnly / content 为空 → 排除；
 *   缺失条目（null/undefined）→ 计入 skipped；
 * - 图片：有 OCR 输出 OCR 文本；无 OCR 输出 `[图片: 文件名]`，绝不输出本地路径。
 */

const FAULT_HINT_RE = /(故障|代码|错误|保护|异常|报错|err|fault)/i

const ENTITY_LABELS = {
  brand: '品牌',
  model: '型号',
  fault_code: '故障码',
  refrigerant: '制冷剂'
}

function imagePlaceholder(item) {
  const name = String(item.content || '').split(/[\\/]/).pop().trim()
  return `[图片: ${name || '图片'}]`
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null
  if (item.metadataOnly || item.sensitivity === 2) return null
  if (item.type === 'image') {
    const ocr = String(item.ocrText || '').trim()
    return { text: ocr || imagePlaceholder(item), kind: 'image' }
  }
  const content = String(item.content || '').trim()
  if (!content) return null
  return { text: content, kind: 'text' }
}

/**
 * 收集可输出条目。
 * @returns {{ texts: Array<{text:string, kind:string}>, skipped: number, excluded: number }}
 */
function collect(items) {
  const texts = []
  let skipped = 0
  let excluded = 0
  for (const item of items || []) {
    if (item === null || item === undefined || typeof item !== 'object') {
      skipped++
      continue
    }
    const n = normalizeItem(item)
    if (!n) {
      excluded++
      continue
    }
    texts.push(n)
  }
  return { texts, skipped, excluded }
}

/**
 * 纯文本（复制全部）：原始内容 + 空行分隔，保持选择顺序。
 */
function buildPlainText(items) {
  const { texts, skipped, excluded } = collect(items)
  return {
    text: texts.map(t => t.text).join('\n\n'),
    count: texts.length,
    skipped,
    excluded
  }
}

/**
 * Markdown（复制/导出）：# 维修记录 + 原始内容，保持选择顺序。
 */
function buildMarkdown(items) {
  const { texts, skipped, excluded } = collect(items)
  const body = texts.map(t => t.text).join('\n\n')
  const text = body ? `# 维修记录\n\n${body}\n` : ''
  return { text, count: texts.length, skipped, excluded }
}

/**
 * 工单草稿（非 AI、确定性整理）：
 *   - 设备信息：来自已识别实体（brand/model/refrigerant），不编造；
 *   - 故障现象：含故障上下文的文字记录（关键词归类，非诊断）；
 *   - 检测记录：其余文字记录；
 *   - 处理过程：留空（无可靠数据）；
 *   - 备注：图片（OCR 或占位）。
 * 所有原文不修改；各栏目内保持选择顺序。
 */
function buildWorkOrderDraft(items) {
  let skipped = 0
  let excluded = 0
  const device = []
  const fault = []
  const records = []
  const notes = []

  for (const item of items || []) {
    if (item === null || item === undefined || typeof item !== 'object') {
      skipped++
      continue
    }
    if (item.metadataOnly || item.sensitivity === 2) {
      excluded++
      continue
    }

    const entities = Array.isArray(item.entities) ? item.entities : []
    for (const e of entities) {
      if (ENTITY_LABELS[e.type] && (e.type === 'brand' || e.type === 'model' || e.type === 'refrigerant')) {
        const line = `${ENTITY_LABELS[e.type]}：${e.value}`
        if (!device.includes(line)) device.push(line)
      }
    }

    if (item.type === 'image') {
      const ocr = String(item.ocrText || '').trim()
      notes.push(ocr || imagePlaceholder(item))
      continue
    }

    const content = String(item.content || '').trim()
    if (!content) {
      excluded++
      continue
    }
    if (FAULT_HINT_RE.test(content)) fault.push(content)
    else records.push(content)
  }

  const sections = []
  sections.push('## 设备信息')
  if (device.length) sections.push(device.map(d => `- ${d}`).join('\n'))
  sections.push('')
  sections.push('## 故障现象')
  if (fault.length) sections.push(fault.join('\n\n'))
  sections.push('')
  sections.push('## 检测记录')
  if (records.length) sections.push(records.join('\n\n'))
  sections.push('')
  sections.push('## 处理过程')
  sections.push('')
  sections.push('## 备注')
  if (notes.length) sections.push(notes.join('\n'))

  const text = `# 维修工单草稿\n\n${sections.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
  return {
    text,
    count: fault.length + records.length + notes.length,
    skipped,
    excluded,
    sections: { device: device.length, fault: fault.length, records: records.length, notes: notes.length }
  }
}

module.exports = {
  collect,
  normalizeItem,
  buildPlainText,
  buildMarkdown,
  buildWorkOrderDraft
}

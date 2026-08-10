/**
 * Entity Query - 搜索串解析（零依赖，renderer / main 通用）
 *
 * 输入：'品牌:大金 故障:U4 R410A'
 * 输出：
 *   {
 *     plain: ['R410A'],
 *     entityFilters: [
 *       { type: 'brand', value: '大金', raw: '品牌:大金' },
 *       { type: 'fault_code', value: 'U4', raw: '故障:U4' }
 *     ]
 *   }
 *
 * 规则：
 *   - 支持中英文前缀：品牌/型号/故障/制冷剂、brand/model/fault/refrigerant；
 *   - 型号仅精确匹配（归一化后），不支持前缀；
 *   - 未知前缀（如 颜色:红）按普通关键词处理；
 *   - 前缀后为空 → 忽略该 token；
 *   - 普通关键词与实体过滤之间为 AND 语义（由调用方执行）。
 */

const { normalizeQuery } = require('./entity-rules.cjs')

const PREFIX_MAP = {
  '品牌': 'brand',
  '型号': 'model',
  '故障': 'fault_code',
  '制冷剂': 'refrigerant',
  'brand': 'brand',
  'model': 'model',
  'fault': 'fault_code',
  'refrigerant': 'refrigerant'
}

const TYPE_LABELS = {
  brand: '品牌',
  model: '型号',
  fault_code: '故障',
  refrigerant: '制冷剂'
}

function parseEntityQuery(input) {
  const plain = []
  const entityFilters = []
  const text = String(input || '')
  const tokens = text.split(/\s+/).filter(Boolean)

  for (const token of tokens) {
    const m = token.match(/^(品牌|型号|故障|制冷剂|brand|model|fault|refrigerant)\s*[:：]\s*(.*)$/i)
    if (m) {
      const rawType = m[1].toLowerCase()
      const type = PREFIX_MAP[rawType] || PREFIX_MAP[m[1]]
      const rawValue = m[2].trim()
      if (!rawValue) continue // 空值忽略
      entityFilters.push({
        type,
        value: normalizeQuery(type, rawValue),
        raw: token
      })
    } else {
      plain.push(token)
    }
  }

  return { plain, entityFilters }
}

function filterLabel(filter) {
  return TYPE_LABELS[filter.type] || filter.type
}

function filterToSearchText(filter) {
  return `${filterLabel(filter)}:${filter.value}`
}

/**
 * 从搜索串中移除某个实体过滤的原始 token（首次出现）。
 */
function stripFilterToken(input, filter) {
  const text = String(input || '')
  const raw = filter && filter.raw
  if (!raw) return text
  const tokens = text.split(/\s+/).filter(Boolean)
  const idx = tokens.findIndex(t => t === raw)
  if (idx === -1) return text
  tokens.splice(idx, 1)
  return tokens.join(' ')
}

module.exports = {
  parseEntityQuery,
  filterLabel,
  filterToSearchText,
  stripFilterToken,
  PREFIX_MAP,
  TYPE_LABELS
}

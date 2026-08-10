/**
 * Entity Rules - 实体识别与查询共用的规则/归一化（零依赖）
 *
 * 保证：识别端（entity-recognition）与查询端（entity-query / db-service）
 * 使用同一套品牌词典、制冷剂、故障码字符集与归一化逻辑。
 */

const BRANDS = [
  { canonical: '大金', aliases: ['大金', 'daikin'] },
  { canonical: '格力', aliases: ['格力', 'gree'] },
  { canonical: '美的', aliases: ['美的', 'midea'] },
  { canonical: '日立', aliases: ['日立', 'hitachi'] },
  { canonical: '三菱', aliases: ['三菱', 'mitsubishi'] },
  { canonical: '松下', aliases: ['松下', 'panasonic'] },
  { canonical: '富士通将军', aliases: ['富士通将军', '富士通', 'fujitsu general', 'fujitsu'] }
]

const REFRIGERANTS = ['R22', 'R410A', 'R32', 'R454B']

const FAULT_LETTERS = 'UEFHJLPAC'

const ENTITY_TYPES = new Set(['brand', 'model', 'fault_code', 'refrigerant', 'url'])

// Chip 展示顺序（url 不展示，但保留在类型集合中）
const ENTITY_DISPLAY_ORDER = ['brand', 'model', 'fault_code', 'refrigerant']
const ENTITY_DISPLAY_INDEX = new Map(
  ENTITY_DISPLAY_ORDER.concat(['url']).map((t, i) => [t, i])
)

function normalizeModel(raw) {
  return String(raw).toUpperCase().replace(/[-/\s]/g, '')
}

/**
 * 品牌别名反解：daikin → 大金；找不到别名时返回原值 trim。
 */
function resolveBrandCanonical(value) {
  const v = String(value || '').trim()
  if (!v) return v
  const lower = v.toLowerCase()
  for (const b of BRANDS) {
    if (b.canonical === v) return b.canonical
    if (b.aliases.some(a => a.toLowerCase() === lower)) return b.canonical
  }
  return v
}

/**
 * 查询值归一化（与识别端存储值保持一致）。
 */
function normalizeQuery(type, value) {
  const v = String(value || '').trim()
  switch (type) {
    case 'brand':
      return resolveBrandCanonical(v)
    case 'model':
      return normalizeModel(v)
    case 'fault_code':
    case 'refrigerant':
      return v.toUpperCase().replace(/\s+/g, '')
    default:
      return v
  }
}

module.exports = {
  BRANDS,
  REFRIGERANTS,
  FAULT_LETTERS,
  ENTITY_TYPES,
  ENTITY_DISPLAY_ORDER,
  ENTITY_DISPLAY_INDEX,
  normalizeModel,
  resolveBrandCanonical,
  normalizeQuery
}

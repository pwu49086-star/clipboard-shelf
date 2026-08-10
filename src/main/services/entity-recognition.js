/**
 * Entity Recognition - 本地规则实体识别（零第三方依赖）
 *
 * v1.5.0：
 *   - 纯本地规则：品牌词典 + 型号正则 + 故障码上下文 + 制冷剂关键词 + URL；
 *   - phone / email 只做内存识别，不持久化（隐私）；
 *   - work_order / equipment_code 本版本不实现；
 *   - 异步消费：订阅 ENTITY_JOB（落库后事件），绝不进入 clipboard pipeline；
 *   - privacy gate：content 为空/加密锁定态的任务直接标记跳过（entityState=2）。
 */

const { eventBus, Events } = require('../core/event-bus')
const db = require('./db-service')

// ====== 常量 ======
const MAX_ANALYZE_LEN = 10000
const PERSIST_MIN_CONFIDENCE = 70

// 持久化实体类型
const PERSIST_TYPES = new Set(['brand', 'model', 'fault_code', 'refrigerant', 'url'])
// 仅内存识别（不落库）
const MEMORY_ONLY_TYPES = new Set(['phone', 'email'])

// ====== 词典与规则 ======

const BRANDS = [
  { canonical: '大金', aliases: ['大金', 'daikin'] },
  { canonical: '格力', aliases: ['格力', 'gree'] },
  { canonical: '美的', aliases: ['美的', 'midea'] },
  { canonical: '日立', aliases: ['日立', 'hitachi'] },
  { canonical: '三菱', aliases: ['三菱', 'mitsubishi'] },
  { canonical: '松下', aliases: ['松下', 'panasonic'] },
  { canonical: '富士通将军', aliases: ['富士通将军', '富士通', 'fujitsu general', 'fujitsu'] }
]

const HVAC_CTX = /(空调|型号|外机|内机|故障|代码|错误|保护|异常|报错|维修|手册|多联机|VRV|VRF|压缩机|制冷|制热|安装|调试|售后|遥控|说明书)/i
const FAULT_CTX = /(故障|代码|错误|保护|异常|报错|err|fault)/i
const REFRIGERANT_CTX = /\b(R22|R410A|R32|R454B)\b/i

const REFRIGERANTS = ['R22', 'R410A', 'R32', 'R454B']

const MODEL_PATTERNS = [
  // 大金
  { brand: '大金', re: /\bRXYQ\d{2,3}[A-Z0-9]{1,8}\b/i },
  { brand: '大金', re: /\bRXQ\d{2,3}[A-Z0-9]{1,8}\b/i },
  { brand: '大金', re: /\bFTX[0-9A-Z]{2,10}\b/i },
  { brand: '大金', re: /\bFXD[0-9A-Z]{2,10}\b/i },
  // 格力
  { brand: '格力', re: /\bGMV-?\d{2,5}[A-Z0-9]{0,8}\b/i },
  { brand: '格力', re: /\bKFR-?\d{2,3}G?W?[A-Z0-9]{0,6}\b/i },
  // 美的
  { brand: '美的', re: /\bMDV-?\d{2,5}[A-Z0-9]{0,8}\b/i },
  { brand: '美的', re: /\bKFR-?\d{2,3}G?W?[A-Z0-9]{0,6}\b/i },
  // 日立
  { brand: '日立', re: /\bRAS-?\d{3}[A-Z0-9]{0,10}\b/i },
  { brand: '日立', re: /\bRAC-?\d{3}[A-Z0-9]{0,10}\b/i },
  // 三菱
  { brand: '三菱', re: /\bPUHY-?[A-Z]?\d{2,4}[A-Z0-9]{0,10}\b/i },
  { brand: '三菱', re: /\bPUMY-?[A-Z]?\d{2,4}[A-Z0-9]{0,10}\b/i },
  { brand: '三菱', re: /\bMSZ-?[A-Z0-9]{2,12}\b/i },
  { brand: '三菱', re: /\bMUZ-?[A-Z0-9]{2,12}\b/i },
  // 松下
  { brand: '松下', re: /\bCS-?[A-Z0-9]{2,12}\b/i },
  { brand: '松下', re: /\bCU-?[A-Z0-9]{2,12}\b/i },
  // 富士通将军
  { brand: '富士通将军', re: /\bAOYG?\d{2,4}[A-Z0-9]{0,10}\b/i },
  { brand: '富士通将军', re: /\bASYG?\d{2,4}[A-Z0-9]{0,10}\b/i }
]

// 通用型号兜底：字母开头 + 数字 + 可选后缀；必须带 HVAC 上下文才保留
const GENERIC_MODEL_RE = /\b[A-Z]{2,4}-?\d{2,5}[A-Z0-9]{0,6}\b/
const GENERIC_MODEL_BLACKLIST = [
  'PDF', 'HTML', 'HTTP', 'HTTPS', 'WWW', 'JSON', 'YAML', 'UUID', 'GUID',
  'SHA', 'AES', 'RSA', 'TLS', 'SSL', 'API', 'CPU', 'GPU', 'RAM', 'ROM',
  'USB', 'HDMI', 'WIFI', 'BLUETOOTH', 'FTP', 'SMTP', 'IMAP', 'POP3'
]

const FAULT_LETTERS = 'UEFHJLPAC'
const FAULT_RE = new RegExp(`\\b([${FAULT_LETTERS}][0-9]{1,2})\\b`, 'g')

const URL_RE = /https?:\/\/[^\s<>"'“”‘’，。；：！？、]+/gi
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}/g

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeModel(raw) {
  return String(raw).toUpperCase().replace(/[-/\s]/g, '')
}

function normalizeUrl(raw) {
  return String(raw).trim().replace(/[.,;:!?)\]}>，。；：！？、]+$/, '')
}

// ====== 各类型识别 ======

function maskUrls(text) {
  const urls = []
  const chars = text.split('')
  let m
  const re = new RegExp(URL_RE.source, URL_RE.flags)
  while ((m = re.exec(text))) {
    urls.push(m[0])
    for (let i = m.index; i < m.index + m[0].length; i++) chars[i] = ' '
  }
  return { masked: chars.join(''), urls }
}

function detectBrands(text) {
  const found = []
  for (const brand of BRANDS) {
    let hit = null
    for (const alias of brand.aliases) {
      if (/[a-z]/.test(alias)) {
        const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i')
        if (re.test(text)) {
          hit = { confidence: 90, matchType: 'dict' }
          break
        }
      } else {
        const idx = text.indexOf(alias)
        if (idx >= 0) {
          const window = text.slice(Math.max(0, idx - 15), idx + alias.length + 15)
          const confidence = HVAC_CTX.test(window) ? 90 : 70
          hit = { confidence, matchType: 'dict' }
          break
        }
      }
    }
    if (hit) {
      found.push({
        type: 'brand',
        value: brand.canonical,
        confidence: hit.confidence,
        match_type: hit.matchType
      })
    }
  }
  return found
}

function detectModels(text, hasBrandOrCtx) {
  const found = []
  const known = new Set()
  for (const p of MODEL_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g')
    let m
    while ((m = re.exec(text))) {
      const value = normalizeModel(m[0])
      if (value.length >= 5) {
        known.add(value)
        found.push({ type: 'model', value, confidence: 90, match_type: 'regex' })
      }
    }
  }

  const g = new RegExp(GENERIC_MODEL_RE.source, GENERIC_MODEL_RE.flags.includes('g') ? GENERIC_MODEL_RE.flags : GENERIC_MODEL_RE.flags + 'g')
  let m
  while ((m = g.exec(text))) {
    const value = normalizeModel(m[0])
    if (value.length < 5) continue
    if (GENERIC_MODEL_BLACKLIST.some(w => value.startsWith(w))) continue
    if ([...known].some(km => km.includes(value))) continue // 已知型号的子串不重复识别
    const window = text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20)
    if (hasBrandOrCtx || HVAC_CTX.test(window)) {
      found.push({ type: 'model', value, confidence: 70, match_type: 'context' })
    }
  }
  return found
}

function detectFaults(text, hasBrand, hasModel, hasRefrigerant) {
  const found = []
  const re = new RegExp(FAULT_RE.source, FAULT_RE.flags)
  let m
  while ((m = re.exec(text))) {
    const code = m[1].toUpperCase()
    const idx = m.index
    const window = text.slice(Math.max(0, idx - 12), idx + m[1].length + 12)
    let confidence
    let matchType
    if (FAULT_CTX.test(window)) {
      confidence = 90
      matchType = 'context'
    } else if (hasBrand || hasModel || hasRefrigerant) {
      confidence = 75
      matchType = 'regex'
    } else {
      continue // 无上下文：A1 / B1 / 01 / E 等不识别
    }
    found.push({ type: 'fault_code', value: code, confidence, match_type: matchType })
  }
  return found
}

function detectRefrigerants(text) {
  const found = []
  for (const r of REFRIGERANTS) {
    const re = new RegExp(`\\b${r}\\b`, 'i')
    if (re.test(text)) {
      found.push({ type: 'refrigerant', value: r.toUpperCase(), confidence: 90, match_type: 'dict' })
    }
  }
  return found
}

function detectPhones(text) {
  const found = []
  const re = new RegExp(PHONE_RE.source, PHONE_RE.flags)
  let m
  while ((m = re.exec(text))) {
    found.push({ type: 'phone', value: m[0], confidence: 80, match_type: 'regex' })
  }
  return found
}

function detectEmails(text) {
  const found = []
  if (!text.includes('@')) return found
  const re = new RegExp(EMAIL_RE.source, EMAIL_RE.flags)
  let m
  while ((m = re.exec(text))) {
    found.push({ type: 'email', value: m[0].toLowerCase(), confidence: 90, match_type: 'regex' })
  }
  return found
}

// ====== 主入口 ======

function dedupe(entities) {
  const map = new Map()
  for (const e of entities) {
    const key = e.type + '|' + e.value
    const cur = map.get(key)
    if (!cur || e.confidence > cur.confidence) map.set(key, e)
  }
  return [...map.values()]
}

/**
 * 识别文本中的实体。
 * @returns {{ entities: Array, truncated: boolean }}
 */
function recognize(text, { maxLength = MAX_ANALYZE_LEN } = {}) {
  if (!text || typeof text !== 'string') return { entities: [], truncated: false }
  const truncated = text.length > maxLength
  const target = truncated ? text.slice(0, maxLength) : text

  try {
    const { masked, urls } = maskUrls(target)

    const refrigerants = detectRefrigerants(masked)
    const brands = detectBrands(masked)
    const hasBrand = brands.length > 0
    const hasRefrigerant = refrigerants.length > 0
    const models = detectModels(masked, hasBrand || hasRefrigerant)
    const hasModel = models.length > 0
    const faults = detectFaults(masked, hasBrand, hasModel, hasRefrigerant)

    // 品牌仅靠中文名且无其他 HVAC 实体时丢弃（如“美的很漂亮”）
    const hasHvacEntity = hasModel || hasRefrigerant || faults.length > 0
    const finalBrands = brands.filter(b => b.confidence >= 90 || hasHvacEntity)

    const phones = detectPhones(masked)
    const emails = detectEmails(masked)
    const urlEntities = urls.map(u => ({
      type: 'url',
      value: normalizeUrl(u),
      confidence: 90,
      match_type: 'regex'
    }))

    const all = dedupe([
      ...finalBrands,
      ...models,
      ...faults,
      ...refrigerants,
      ...urlEntities,
      ...phones,
      ...emails
    ])
    return { entities: all, truncated }
  } catch (err) {
    console.error('[EntityRecognition] recognize error:', err)
    return { entities: [], truncated }
  }
}

/**
 * 是否应持久化：类型在白名单且置信度达标。
 */
function shouldPersist(entity) {
  return !!entity && PERSIST_TYPES.has(entity.type) && entity.confidence >= PERSIST_MIN_CONFIDENCE
}

// ====== 异步消费者（落库后事件驱动） ======

const queue = []
let processing = false

function enqueue(job) {
  queue.push(job)
  if (!processing) {
    processing = true
    setImmediate(drain)
  }
}

function drain() {
  const job = queue.shift()
  if (!job) {
    processing = false
    return
  }
  try {
    handle(job)
  } catch (err) {
    console.error('[EntityRecognition] job error:', err)
  }
  setImmediate(drain)
}

function handle(job) {
  if (!job || !job.itemId) return
  if (!job.content || typeof job.content !== 'string') {
    // privacy gate：无内容（敏感/仅元数据/加密锁定）→ 标记跳过
    db.markEntityState(job.itemId, 2)
    return
  }
  const { entities } = recognize(job.content)
  const persistable = entities.filter(shouldPersist)
  db.insertEntities(job.itemId, persistable)
  eventBus.emit(Events.ENTITY_DONE, {
    itemId: job.itemId,
    count: persistable.length,
    types: [...new Set(persistable.map(e => e.type))]
  })
}

function init() {
  eventBus.on(Events.ENTITY_JOB, (job) => enqueue(job), 'entity-recognition')
}

function flush() {
  return new Promise((resolve) => {
    const check = () => {
      if (!processing && queue.length === 0) resolve()
      else setTimeout(check, 5)
    }
    check()
  })
}

module.exports = {
  recognize,
  shouldPersist,
  PERSIST_TYPES,
  MEMORY_ONLY_TYPES,
  MAX_ANALYZE_LEN,
  init,
  flush,
  _test: { handle }
}

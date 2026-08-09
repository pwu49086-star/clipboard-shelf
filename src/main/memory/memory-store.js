/**
 * Memory Store V2 - 简化版
 *
 * 删掉"假智能"
 * 只做：存储 + 去重 + 标签 + 时间索引
 *
 * 三层：
 *   1. Raw Store（纯数据）
 *   2. Indexed Layer（tag / time / category）
 *   3. Frequency Boost（重复计数 → 重要性）
 */

const { eventBus, Events } = require('../core/event-bus')
const { classify, extractTags, calcImportance } = require('./intent-classifier')

// ====== 内存索引 ======
const store = new Map()      // id → memory
const byCategory = new Map() // category → Set<id>
const byDate = new Map()     // date string → Set<id>
const byTag = new Map()      // tag → Set<id>
const contentHash = new Map() // normalizedContent → id (O(1) 查重)

// ====== Helper ======
function getDateStr(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getTimePeriod(ts) {
  const hour = new Date(ts).getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  return 'night'
}

function addToIndex(map, key, id) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(id)
}

function removeFromIndex(map, key, id) {
  const set = map.get(key)
  if (set) { set.delete(id); if (set.size === 0) map.delete(key) }
}

// ====== 去重 ======
function normalizeContent(content) {
  return content ? content.trim().toLowerCase() : ''
}

function findDuplicate(content) {
  if (!content) return null
  const normalized = normalizeContent(content)
  if (!normalized) return null
  const id = contentHash.get(normalized)
  return id ? store.get(id) || null : null
}

// ====== Core API ======

function addMemory(item) {
  const now = Date.now()
  const content = item.content || ''

  // 去重
  const existing = findDuplicate(content)
  if (existing) {
    existing.repeatCount++
    existing.lastSeen = now
    existing.importance = calcImportance(content, existing.repeatCount)
    eventBus.emit(Events.MEMORY_REPEAT, { id: existing.id, count: existing.repeatCount }, 'memory-store')
    return existing
  }

  // 分类
  const { category, tags: categoryTags } = classify(content, item.type)
  const tags = [...new Set([...extractTags(content), ...categoryTags])]
  const dateStr = getDateStr(now)

  // 创建记忆
  const memory = {
    id: item.id || Date.now(),
    content,
    type: item.type || 'text',
    category,
    tags,
    importance: calcImportance(content, 1),
    repeatCount: 1,
    firstSeen: now,
    lastSeen: now,
    date: dateStr,
    timePeriod: getTimePeriod(now),
    pinned: false,
    favorite: item.isFavorite === 1,
    filePath: item.filePath,
    thumbPath: item.thumbPath,
    ocrText: item.ocrText,
  }

  // 添加到索引
  store.set(memory.id, memory)
  addToIndex(byCategory, category, memory.id)
  addToIndex(byDate, dateStr, memory.id)
  tags.forEach(tag => addToIndex(byTag, tag, memory.id))
  // 添加到内容哈希索引
  const normalized = normalizeContent(content)
  if (normalized) contentHash.set(normalized, memory.id)

  // 高重要性自动升格
  if (memory.importance >= 70) {
    memory.pinned = true
    eventBus.emit(Events.MEMORY_PIN, { id: memory.id }, 'memory-store')
  }

  eventBus.emit(Events.MEMORY_NEW, { id: memory.id, category }, 'memory-store')
  return memory
}

function removeMemory(id) {
  const memory = store.get(id)
  if (!memory) return
  store.delete(id)
  removeFromIndex(byCategory, memory.category, id)
  removeFromIndex(byDate, memory.date, id)
  memory.tags.forEach(tag => removeFromIndex(byTag, tag, id))
  // 清理内容哈希索引
  const normalized = normalizeContent(memory.content)
  if (normalized && contentHash.get(normalized) === id) {
    contentHash.delete(normalized)
  }
}

// ====== 查询 ======

function getByCategory(category, limit = 50) {
  const ids = byCategory.get(category)
  if (!ids) return []
  return [...ids]
    .map(id => store.get(id))
    .filter(Boolean)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit)
}

function getByDate(dateStr) {
  const ids = byDate.get(dateStr)
  if (!ids) return []
  return [...ids]
    .map(id => store.get(id))
    .filter(Boolean)
    .sort((a, b) => a.firstSeen - b.firstSeen)
}

function getToday() {
  return getByDate(getDateStr(Date.now()))
}

function getByTag(tag) {
  const ids = byTag.get(tag)
  if (!ids) return []
  return [...ids]
    .map(id => store.get(id))
    .filter(Boolean)
    .sort((a, b) => b.lastSeen - a.lastSeen)
}

function getRecent(limit = 20) {
  return [...store.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit)
}

function getPinned() {
  return [...store.values()].filter(m => m.pinned)
}

// ====== 搜索（简化版：时间 + 关键词 + 频率）======
function search(query, options = {}) {
  const { category, dateFrom, dateTo, limit = 50 } = options
  let results = [...store.values()]

  // 按分类过滤
  if (category) results = results.filter(m => m.category === category)

  // 按日期过滤
  if (dateFrom) results = results.filter(m => m.firstSeen >= dateFrom)
  if (dateTo) results = results.filter(m => m.firstSeen <= dateTo)

  // 关键词搜索
  if (query) {
    const q = query.toLowerCase()
    results = results.filter(m =>
      (m.content && m.content.toLowerCase().includes(q)) ||
      (m.ocrText && m.ocrText.toLowerCase().includes(q)) ||
      m.tags.some(t => t.toLowerCase().includes(q))
    )
  }

  // 排序：重要性 30% + 最后出现 70%
  if (results.length > 0) {
    const maxTime = Math.max(...results.map(r => r.lastSeen))
    const minTime = Math.min(...results.map(r => r.lastSeen))
    const timeRange = maxTime - minTime || 1
    results.sort((a, b) => {
      const impDiff = (b.importance - a.importance) / 100 * 0.3
      const timeDiff = ((b.lastSeen - minTime) / timeRange - (a.lastSeen - minTime) / timeRange) * 0.7
      return impDiff + timeDiff
    })
  }

  return results.slice(0, limit)
}

// ====== 统计 ======
function getStats() {
  const categoryCounts = {}
  for (const [cat, ids] of byCategory) {
    categoryCounts[cat] = ids.size
  }

  const tagCounts = {}
  for (const [tag, ids] of byTag) {
    tagCounts[tag] = ids.size
  }

  return {
    total: store.size,
    categories: categoryCounts,
    topTags: Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count })),
    pinnedCount: getPinned().length,
    todayCount: getToday().length
  }
}

// ====== 加载 ======
function loadFromDB(items) {
  for (const item of items) {
    addMemory(item)
  }
}

function clear() {
  store.clear()
  byCategory.clear()
  byDate.clear()
  byTag.clear()
  contentHash.clear()
}

function init() {
  eventBus.on(Events.DB_INSERT, (item) => addMemory(item), 'memory-store')
  eventBus.on(Events.DB_DELETE, ({ id }) => removeMemory(id), 'memory-store')
  eventBus.on(Events.DB_BATCH_DELETE, ({ ids }) => {
    // 批量删除，减少单独事件开销
    ids.forEach(id => removeMemory(id))
  }, 'memory-store')
  eventBus.on(Events.DB_FAVORITE, ({ id }) => {
    const m = store.get(id); if (m) m.favorite = !m.favorite
  }, 'memory-store')
}

module.exports = {
  init, addMemory, removeMemory,
  getByCategory, getByDate, getToday, getByTag, getRecent, getPinned,
  search, getStats, loadFromDB, clear
}

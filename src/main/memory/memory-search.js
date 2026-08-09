/**
 * Memory Search V2 - 简化版
 *
 * 删掉"假 semantic search"
 * 只做：时间 + 关键词 + 频率
 */

const { search, getByCategory, getToday, getRecent, getPinned } = require('./memory-store')

// ====== 时间词 ======
const TIME_KEYWORDS = {
  '今天': () => dayRange(0),
  '昨天': () => dayRange(1),
  '前天': () => dayRange(2),
  '本周': () => weekRange(0),
  '上周': () => weekRange(1),
  '刚刚': () => recentRange(30 * 60 * 1000),
  '刚才': () => recentRange(60 * 60 * 1000),
  '最近': () => recentRange(24 * 60 * 60 * 1000),
}

function dayRange(daysAgo) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo)
  return { from: start.getTime(), to: start.getTime() + 86400000 }
}

function weekRange(weeksAgo) {
  const now = new Date()
  const day = now.getDay() || 7
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1 - weeksAgo * 7)
  return { from: start.getTime(), to: start.getTime() + 7 * 86400000 }
}

function recentRange(ms) {
  return { from: Date.now() - ms, to: Date.now() }
}

// ====== 分类词 ======
const CATEGORY_KEYWORDS = {
  '代码': 'code', 'code': 'code',
  '链接': 'link', 'url': 'link', '网址': 'link', 'link': 'link',
  '图片': 'image', '截图': 'image', 'image': 'image',
  '文字': 'text', '文本': 'text', 'text': 'text',
}

// ====== 智能搜索 ======
function smartSearch(query) {
  if (!query) return { results: getRecent(20), parsed: { keywords: [], category: null, timeRange: null } }

  let remaining = query
  let category = null
  let timeRange = null

  // 提取时间词
  for (const [keyword, getRange] of Object.entries(TIME_KEYWORDS)) {
    if (remaining.includes(keyword)) {
      timeRange = getRange()
      remaining = remaining.replace(keyword, '').trim()
      break
    }
  }

  // 提取分类词
  for (const [keyword, cat] of Object.entries(CATEGORY_KEYWORDS)) {
    if (remaining.includes(keyword)) {
      category = cat
      remaining = remaining.replace(keyword, '').trim()
      break
    }
  }

  const keywords = remaining.split(/\s+/).filter(k => k.length > 0)
  const options = {}
  if (category) options.category = category
  if (timeRange) { options.dateFrom = timeRange.from; options.dateTo = timeRange.to }

  const keywordQuery = keywords.join(' ')
  const results = search(keywordQuery, options)

  return {
    results: results.slice(0, 20),
    parsed: { keywords, category, timeRange },
    total: results.length
  }
}

// ====== 快捷搜索 ======
function quickSearch(type) {
  switch (type) {
    case 'recent': return getRecent(20)
    case 'code': return getByCategory('code', 20)
    case 'link': return getByCategory('link', 20)
    case 'image': return getByCategory('image', 20)
    case 'pinned': return getPinned()
    case 'today': return getToday()
    default: return []
  }
}

module.exports = { smartSearch, quickSearch }

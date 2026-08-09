/**
 * Memory Timeline V2 - 简化版
 *
 * 只做：今日时间线 + 统计 + 宠物反馈
 */

const { getToday, getStats } = require('./memory-store')
const { eventBus, Events } = require('../core/event-bus')

// ====== 今日时间线 ======
function getTodayTimeline() {
  const today = getToday()
  return today.map(m => ({
    id: m.id,
    time: formatTime(m.firstSeen),
    category: m.category,
    preview: m.content ? m.content.substring(0, 60).replace(/\n/g, ' ') : '',
    importance: m.importance,
    repeatCount: m.repeatCount,
    tags: m.tags.slice(0, 3)
  }))
}

function formatTime(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ====== 今日摘要 ======
function getTodaySummary() {
  const today = getToday()
  const summary = { morning: [], afternoon: [], evening: [], night: [] }

  for (const m of today) {
    summary[m.timePeriod].push({
      category: m.category,
      preview: m.content ? m.content.substring(0, 50) : '',
      count: m.repeatCount
    })
  }

  return summary
}

// ====== 统计 ======
function getActivityStats() {
  const stats = getStats()
  const today = getToday()

  // 今日分类计数
  const todayCategories = {}
  for (const m of today) {
    todayCategories[m.category] = (todayCategories[m.category] || 0) + 1
  }

  // 最活跃时段
  const hourCounts = new Array(24).fill(0)
  for (const m of today) {
    hourCounts[new Date(m.firstSeen).getHours()]++
  }
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts))

  return {
    total: stats.total,
    today: today.length,
    todayCategories,
    peakHour: peakHour >= 0 ? `${peakHour}:00` : null,
    pinnedCount: stats.pinnedCount,
    topTags: stats.topTags.slice(0, 5)
  }
}

// ====== 宠物反馈 ======
function getPetFeedback() {
  const today = getToday()

  if (today.length === 0) return { icon: 'Moon', text: '今天还没有活动...' }

  // 一次遍历统计各分类计数（避免重复过滤数组 + 省掉无用的 getActivityStats 调用）
  const counts = { code: 0, link: 0, image: 0, text: 0 }
  for (const m of today) {
    if (counts[m.category] !== undefined) counts[m.category]++
  }

  // 分类特定反馈（优先于通用统计）
  if (counts.code > 10) return { icon: 'Code', text: `今天写了好多代码！(${counts.code} 条)` }
  if (counts.link > 5) return { icon: 'Link', text: `今天收藏了不少链接 (${counts.link} 条)` }
  if (counts.image > 10) return { icon: 'Image', text: `今天截了不少图 (${counts.image} 张)` }

  // 通用统计反馈
  if (today.length > 50) return { icon: 'Flame', text: `今天好忙！复制了 ${today.length} 次` }
  if (today.length > 20) return { icon: 'TrendingUp', text: `今天效率不错，${today.length} 次复制` }

  return { icon: 'Smile', text: `今天复制了 ${today.length} 次` }
}

// ====== Init ======
let updateTimer = null

function init() {
  updateTimer = setInterval(() => {
    eventBus.emit('memory:timeline:update', getTodaySummary(), 'memory-timeline')
  }, 3600000)

  eventBus.on(Events.APP_QUIT, () => {
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null }
  }, 'memory-timeline')
}

module.exports = { init, getTodayTimeline, getTodaySummary, getActivityStats, getPetFeedback }

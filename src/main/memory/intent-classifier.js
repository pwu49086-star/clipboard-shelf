/**
 * Content Tagger V2 - 简化版
 *
 * 删掉"假智能"的 11 种 intent
 * 只做：简单分类 + 标签提取
 *
 * 4 种基础类型（不是 11 种）：
 *   text   - 普通文字
 *   code   - 代码片段
 *   link   - URL
 *   image  - 图片
 */

// ====== 简单分类 ======
function classify(content, type) {
  if (!content) return { category: 'text', tags: [] }
  if (type === 'image') return { category: 'image', tags: [] }

  const text = content.trim()

  // URL
  if (/^https?:\/\//i.test(text) || /^www\./i.test(text)) {
    return { category: 'link', tags: ['link'] }
  }

  // 代码（简单判断）
  if (
    /[{}\[\]();]/.test(text) &&
    (text.includes('function') || text.includes('=>') || text.includes('import') ||
     text.includes('class') || text.includes('const ') || text.includes('let ') ||
     text.includes('var ') || text.includes('def ') || text.includes('return '))
  ) {
    return { category: 'code', tags: ['code'] }
  }

  // 默认
  return { category: 'text', tags: [] }
}

// ====== 标签提取 ======
function extractTags(content) {
  if (!content) return []
  const tags = new Set()

  // # 标签
  const hashTags = content.match(/#[一-龥a-zA-Z0-9_]+/g)
  if (hashTags) hashTags.forEach(t => tags.add(t))

  // @ 提及
  const mentions = content.match(/@[一-龥a-zA-Z0-9_]+/g)
  if (mentions) mentions.forEach(t => tags.add(t))

  // URL
  const urls = content.match(/https?:\/\/[^\s]+/g)
  if (urls) tags.add('🔗')

  // 文件扩展名
  const exts = content.match(/\.(js|ts|py|java|json|yaml|md|txt|csv|html|css|sql|sh)\b/gi)
  if (exts) exts.forEach(t => tags.add(t.toLowerCase()))

  return [...tags]
}

// ====== 重要性（简化版）======
function calcImportance(content, repeatCount = 1) {
  let score = 50

  // 重复次数
  score += Math.min(30, repeatCount * 10)

  // 长度
  if (content && content.length > 500) score += 10
  if (content && content.length > 2000) score += 10

  // 关键词
  const keywords = ['important', '重要', 'urgent', '紧急', 'bug', 'fix', 'error']
  for (const kw of keywords) {
    if (content && content.toLowerCase().includes(kw)) {
      score += 15
      break
    }
  }

  return Math.min(100, score)
}

module.exports = { classify, extractTags, calcImportance }

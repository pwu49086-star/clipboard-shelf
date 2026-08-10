/**
 * Items Merge - 列表增量合并纯逻辑（v1.6.0）
 *
 * 修复 slice(0,200) 导致的可见列表收敛问题：
 * 新记录到达时不再截断列表；排序语义保持原样
 * （收藏优先，再按 createTime 倒序）。
 */

function mergeItemIntoList(prev, item) {
  const list = Array.isArray(prev) ? prev : []
  const idx = list.findIndex(i => i.id === item.id)
  if (idx >= 0) {
    const next = [...list]
    next[idx] = item
    return next
  }
  const next = [item, ...list]
  next.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0)
    return b.createTime - a.createTime
  })
  return next
}

module.exports = { mergeItemIntoList }

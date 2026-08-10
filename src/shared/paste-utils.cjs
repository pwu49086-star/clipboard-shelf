/**
 * Paste Utils - 编号粘贴 / 顺序粘贴 / 纯文本粘贴的纯逻辑
 *
 * 与 React/Electron 解耦，便于 node:test 直接测试。
 */

/**
 * 数字键 1~9 → 列表下标（0-based）
 * @param {string} key - 按下的键（'1'~'9'）
 * @param {number} length - 列表长度
 * @returns {number|null} 命中返回下标，否则 null
 */
function numberedIndex(key, length) {
  if (length <= 0) return null
  const n = Number(key)
  if (!Number.isInteger(n) || n < 1 || n > 9 || n > length) return null
  return n - 1
}

/**
 * 顺序粘贴：当前下标 + 1（到末尾后回到第一条）
 * @param {number} current - 当前下标（-1 表示无选中，从头开始）
 * @param {number} length - 列表长度
 * @returns {number|null}
 */
function nextIndex(current, length) {
  if (length <= 0) return null
  if (!Number.isInteger(current) || current < 0) return 0
  return (current + 1) % length
}

/**
 * 纯文本粘贴载荷：仅文字且内容非空时返回可写入剪贴板的 {type, content}
 * 图片 / 空内容 / 仅元数据记录返回 null（无法纯文本化）
 */
function plainTextPayload(item) {
  if (!item || item.type !== 'text' || !item.content) return null
  return { type: 'text', content: item.content }
}

module.exports = { numberedIndex, nextIndex, plainTextPayload }

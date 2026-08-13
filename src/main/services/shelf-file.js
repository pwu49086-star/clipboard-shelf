const path = require('node:path')

const ALLOWED_DIRS = new Set(['thumb', 'full', 'annotated'])
const ANNOTATED_RE = /^\d+_\d+\.png$/

/**
 * shelf-file 协议 URL 解析（纯函数，可单测）。
 * 安全模型：子目录白名单 + path.resolve 越界检查；annotated 仅放行合法命名。
 */
function resolveShelfFile(url, imagesDir) {
  if (!url || !imagesDir) return null
  const rest = String(url).replace(/^shelf-file:\/\//, '')
  const [subdir, ...restParts] = rest.split('/')
  const filename = restParts.join('/')
  if (!ALLOWED_DIRS.has(subdir) || !filename) return null
  if (filename.includes('..') || filename.includes('%')) return null
  if (subdir === 'annotated' && !ANNOTATED_RE.test(filename)) return null
  const resolved = path.resolve(path.join(imagesDir, subdir, filename))
  const root = path.resolve(imagesDir) + path.sep
  if (!resolved.startsWith(root)) return null
  return resolved
}

module.exports = { resolveShelfFile, ALLOWED_DIRS, ANNOTATED_RE }

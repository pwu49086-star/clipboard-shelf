/**
 * Capture Policy + Sensitivity - 落库前的捕获决策
 *
 * sensitivity 级别：
 *   0 = normal（正常保存）
 *   1 = sensitive（保存，预览打码）
 *   2 = highly_sensitive（只保留元数据，不保存内容）
 *
 * 决策必须在内容落库之前执行。
 */

const HIGHLY_SENSITIVE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /(mongodb|postgres|mysql):\/\/[^\s:@]+:[^\s:@]+@/,
  /\b(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6(?:011|5[0-9]{2}))[ -]?(?:[0-9]{4}[ -]?){3}\b/
]

const SENSITIVE_PATTERNS = [
  /\b1[3-9]\d{9}\b/,           // 中国大陆手机号
  /\b\d{17}[\dXx]\b/           // 18 位身份证号（粗匹配）
]

function classifySensitivity(text) {
  if (!text) return 0
  if (HIGHLY_SENSITIVE_PATTERNS.some(p => p.test(text))) return 2
  if (SENSITIVE_PATTERNS.some(p => p.test(text))) return 1
  return 0
}

function normalizeAppName(name) {
  return String(name || '').toLowerCase().replace(/\.exe$/i, '')
}

/**
 * 返回 { action: 'ignore' | 'metadata' | 'capture', sensitivity }
 */
function shouldCapture({ text, sourceApp, options = {} }) {
  if (options.enabled === false) {
    return { action: 'ignore', sensitivity: 0 }
  }

  const app = normalizeAppName(sourceApp)
  const ignoreApps = (options.ignoreApps || []).map(normalizeAppName)
  const metadataOnlyApps = (options.metadataOnlyApps || []).map(normalizeAppName)

  if (app && ignoreApps.includes(app)) {
    return { action: 'ignore', sensitivity: 0 }
  }

  let sensitivity = 0
  if (options.skipSensitive !== false) {
    sensitivity = classifySensitivity(text)
  }

  if (app && metadataOnlyApps.includes(app)) {
    return { action: 'metadata', sensitivity }
  }
  if (sensitivity === 2) {
    return { action: 'metadata', sensitivity }
  }
  return { action: 'capture', sensitivity }
}

module.exports = { classifySensitivity, shouldCapture, normalizeAppName }

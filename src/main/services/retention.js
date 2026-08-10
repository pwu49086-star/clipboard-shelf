/**
 * Retention Service - 自动清理策略
 *
 * 默认策略：
 *   enabled: true
 *   maxItems: 2000      （0 = 不限制）
 *   maxDays: 0          （0 = 不启用）
 *   maxImageItems: 0    （0 = 不限制）
 *
 * 规则：
 *   - 收藏内容永不自动删除
 *   - 超过 maxItems 时优先删除最旧的未收藏记录
 *   - enabled=false 可完全关闭自动清理
 */

const fs = require('fs')
const db = require('./db-service')

const DEFAULT_POLICY = {
  enabled: true,
  maxItems: 2000,
  maxDays: 0,
  maxImageItems: 0
}

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 每天一次

let policy = { ...DEFAULT_POLICY }
let timer = null

/**
 * 把用户配置归一化为合法 policy（非法值回落默认）
 */
function resolvePolicy(input = {}) {
  const num = (v, dflt) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : dflt)
  return {
    enabled: input.enabled !== false,
    maxItems: num(input.maxItems, DEFAULT_POLICY.maxItems),
    maxDays: num(input.maxDays, DEFAULT_POLICY.maxDays),
    maxImageItems: num(input.maxImageItems, DEFAULT_POLICY.maxImageItems)
  }
}

function configure(input) {
  policy = resolvePolicy(input)
  return getPolicy()
}

function getPolicy() {
  return { ...policy }
}

/**
 * 执行一次清理，返回被删记录（已删除对应图片文件）
 */
function run() {
  const current = resolvePolicy(policy)
  if (!current.enabled) return []
  const deleted = db.cleanByPolicy(current)
  for (const row of deleted) {
    if (row.filePath) try { fs.unlinkSync(row.filePath) } catch {}
    if (row.thumbPath) try { fs.unlinkSync(row.thumbPath) } catch {}
  }
  return deleted
}

/**
 * 启动：立即清理一次 + 每日定时
 */
function start() {
  if (timer) return
  run()
  timer = setInterval(run, CLEANUP_INTERVAL_MS)
  if (timer.unref) timer.unref()
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

module.exports = {
  configure,
  getPolicy,
  resolvePolicy,
  run,
  start,
  stop,
  DEFAULT_POLICY
}

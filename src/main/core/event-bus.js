/**
 * Event Bus V2 - 分级事件系统
 *
 * 三层事件：
 *   SYSTEM  - 系统级（IO/DB/网络）- 不关心业务
 *   DOMAIN  - 业务级（memory/pet/clipboard）- 核心逻辑
 *   UI      - 表现层（refresh/notify）- 只关心显示
 *
 * 核心原则：
 *   - SYSTEM 不依赖 DOMAIN
 *   - DOMAIN 不依赖 UI
 *   - UI 只订阅，不发布
 *   - 每个事件有 traceId，可追踪
 */

// ====== Event Tiers ======
const Tier = {
  SYSTEM: 'system',  // IO / DB / 网络
  DOMAIN: 'domain',  // 业务逻辑
  UI: 'ui'           // 表现层
}

// ====== Event Definitions ======
const Events = {
  // ---- SYSTEM (不关心业务) ----
  CLIPBOARD_RAW:     { name: 'clipboard:raw',     tier: Tier.SYSTEM },
  DB_WRITE:          { name: 'db:write',          tier: Tier.SYSTEM },
  DB_FLUSH:          { name: 'db:flush',          tier: Tier.SYSTEM },
  OCR_JOB:           { name: 'ocr:job',           tier: Tier.SYSTEM },
  OCR_DONE:          { name: 'ocr:done',          tier: Tier.SYSTEM },
  FILE_SAVE:         { name: 'file:save',         tier: Tier.SYSTEM },
  FILE_DELETE:       { name: 'file:delete',       tier: Tier.SYSTEM },

  // ---- DOMAIN (业务逻辑) ----
  CLIPBOARD_TEXT:    { name: 'clipboard:text',    tier: Tier.DOMAIN },
  CLIPBOARD_IMAGE:   { name: 'clipboard:image',   tier: Tier.DOMAIN },
  CLIPBOARD_DEDUP:   { name: 'clipboard:dedup',   tier: Tier.DOMAIN },
  DB_INSERT:         { name: 'db:insert',          tier: Tier.DOMAIN },
  DB_DELETE:         { name: 'db:delete',          tier: Tier.DOMAIN },
  DB_BATCH_DELETE:   { name: 'db:batch-delete',    tier: Tier.DOMAIN },
  DB_UPDATE:         { name: 'db:update',          tier: Tier.DOMAIN },
  DB_FAVORITE:       { name: 'db:favorite',        tier: Tier.DOMAIN },
  MEMORY_NEW:        { name: 'memory:new',         tier: Tier.DOMAIN },
  MEMORY_REPEAT:     { name: 'memory:repeat',      tier: Tier.DOMAIN },
  MEMORY_PIN:        { name: 'memory:pin',         tier: Tier.DOMAIN },
  PET_MOOD:          { name: 'pet:mood',           tier: Tier.DOMAIN },
  PET_FAVOR:         { name: 'pet:favor',          tier: Tier.DOMAIN },
  PET_LEVEL:         { name: 'pet:level',          tier: Tier.DOMAIN },
  USER_ACTIVE:       { name: 'user:active',        tier: Tier.DOMAIN },
  USER_IDLE:         { name: 'user:idle',          tier: Tier.DOMAIN },
  USER_TYPING:       { name: 'user:typing',        tier: Tier.DOMAIN },

  // ---- UI (只订阅，不发布) ----
  UI_REFRESH:        { name: 'ui:refresh',         tier: Tier.UI },
  UI_TOAST:          { name: 'ui:toast',           tier: Tier.UI },
  PET_NOTIFY:        { name: 'pet:notify',         tier: Tier.UI },
  PET_SPEAK:         { name: 'pet:speak',          tier: Tier.UI },
  PET_BEHAVIOR:      { name: 'pet:behavior',       tier: Tier.UI },
  WINDOW_SHOW:       { name: 'window:show',        tier: Tier.UI },
  WINDOW_HIDE:       { name: 'window:hide',        tier: Tier.UI },

  // ---- APP ----
  APP_READY:         { name: 'app:ready',          tier: Tier.SYSTEM },
  APP_QUIT:          { name: 'app:quit',           tier: Tier.SYSTEM },
}

// ====== Event Log (Observability) ======
const MAX_LOG_SIZE = 500
const eventLog = []
let traceCounter = 0

function logEvent(event, payload, source) {
  const entry = {
    id: ++traceCounter,
    event: typeof event === 'string' ? event : event.name,
    tier: typeof event === 'string' ? 'unknown' : event.tier,
    timestamp: Date.now(),
    source: source || 'unknown',
    payload: payload ? JSON.stringify(payload).substring(0, 200) : null
  }

  eventLog.push(entry)
  if (eventLog.length > MAX_LOG_SIZE) {
    eventLog.shift()
  }

  return entry.id
}

function getEventLog(limit = 50) {
  return eventLog.slice(-limit)
}

// ====== EventBus ======
class EventBus {
  constructor() {
    this._handlers = new Map() // event name → Set<handler>
    this._onceHandlers = new Map()
  }

  /**
   * 订阅事件
   * @param {string|object} event - 事件名或事件定义
   * @param {Function} fn - 处理函数
   * @param {string} source - 来源标识（用于 debug）
   * @returns {Function} 取消订阅
   */
  on(event, fn, source) {
    const name = typeof event === 'string' ? event : event.name
    if (!this._handlers.has(name)) {
      this._handlers.set(name, new Set())
    }
    this._handlers.get(name).add({ fn, source })

    return () => this.off(event, fn)
  }

  /**
   * 订阅一次
   */
  once(event, fn, source) {
    const name = typeof event === 'string' ? event : event.name
    if (!this._onceHandlers.has(name)) {
      this._onceHandlers.set(name, new Set())
    }
    this._onceHandlers.get(name).add({ fn, source })
  }

  /**
   * 取消订阅
   */
  off(event, fn) {
    const name = typeof event === 'string' ? event : event.name
    if (fn) {
      const handlers = this._handlers.get(name)
      if (handlers) {
        for (const h of handlers) {
          if (h.fn === fn) { handlers.delete(h); break }
        }
      }
    } else {
      this._handlers.delete(name)
      this._onceHandlers.delete(name)
    }
  }

  /**
   * 触发事件
   * @param {string|object} event - 事件名或事件定义
   * @param {*} payload - 数据
   * @param {string} source - 来源标识
   */
  emit(event, payload, source) {
    const name = typeof event === 'string' ? event : event.name

    // 记录日志
    logEvent(event, payload, source)

    // 普通订阅
    const handlers = this._handlers.get(name)
    if (handlers) {
      for (const h of handlers) {
        try {
          h.fn(payload)
        } catch (err) {
          console.error(`[EventBus] Error in "${name}" handler (${h.source}):`, err)
        }
      }
    }

    // 一次性订阅
    const onceHandlers = this._onceHandlers.get(name)
    if (onceHandlers) {
      for (const h of onceHandlers) {
        try {
          h.fn(payload)
        } catch (err) {
          console.error(`[EventBus] Error in "${name}" once-handler (${h.source}):`, err)
        }
      }
      this._onceHandlers.delete(name)
    }
  }

  /**
   * 调试：列出已注册事件
   */
  listHandlers() {
    const result = {}
    for (const [name, handlers] of this._handlers) {
      result[name] = [...handlers].map(h => h.source || 'anonymous')
    }
    return result
  }

  /**
   * 清除所有订阅
   */
  clear() {
    this._handlers.clear()
    this._onceHandlers.clear()
  }
}

// ====== 单例 ======
const eventBus = new EventBus()

module.exports = { eventBus, Events, Tier, getEventLog, logEvent }

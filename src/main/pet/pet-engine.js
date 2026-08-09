/**
 * Pet Engine V2 - 加入 Context Model
 *
 * 之前：state → behavior
 * 现在：state + context → behavior
 *
 * Context = 用户状态理解
 *   - activityLevel (用户活跃度)
 *   - focusState (用户是否在专注)
 *   - idleTime (空闲时长)
 *   - recentActions (最近操作)
 */

const { eventBus, Events, Tier } = require('../core/event-bus')

// ====== Config ======
const TICK_INTERVAL = 1000
const MOOD_DECAY_INTERVAL = 60000

// ====== Pet State ======
const state = {
  mood: 80,
  energy: 100,
  boredom: 0,
  currentBehavior: 'idle',
  lastInteraction: Date.now(),
  isTyping: false,
  isWalking: false,
}

// ====== User Context ======
const context = {
  activityLevel: 'active',   // active / idle / away
  focusState: 'unfocused',   // focused / unfocused
  idleTime: 0,               // 连续空闲时长(ms)
  recentActions: [],         // 最近 10 个操作
  lastClipboardTime: 0,      // 最后一次复制时间
  clipboardCount: 0,         // 今日复制次数
  lastCountDate: new Date().toDateString(), // 用于检测日期变更
}

function updateContext() {
  const now = Date.now()
  const idleMs = now - state.lastInteraction

  // 活跃度
  if (idleMs < 60000) context.activityLevel = 'active'
  else if (idleMs < 300000) context.activityLevel = 'idle'
  else context.activityLevel = 'away'

  // 空闲时长
  context.idleTime = idleMs

  // 专注状态（连续复制 > 3 次且间隔 < 30s）
  const recentClips = context.recentActions.filter(a => a.type === 'clipboard')
  if (recentClips.length >= 3) {
    const lastThree = recentClips.slice(-3)
    const intervals = []
    for (let i = 1; i < lastThree.length; i++) {
      intervals.push(lastThree[i].time - lastThree[i - 1].time)
    }
    context.focusState = intervals.every(i => i < 30000) ? 'focused' : 'unfocused'
  } else {
    context.focusState = 'unfocused'
  }
}

function addRecentAction(type, data) {
  context.recentActions.push({ type, data, time: Date.now() })
  if (context.recentActions.length > 10) context.recentActions.shift()
}

// ====== Behaviors ======
const behaviors = {
  idle: {
    priority: (s, c) => 0.1,
    execute: () => ({ action: 'idle' })
  },

  reactClipboard: {
    priority: (s, c) => {
      const timeSince = Date.now() - c.lastClipboardTime
      if (timeSince < 2000) return 0.9
      return 0
    },
    execute: (s, c) => {
      if (c.clipboardCount > 50) return { action: 'speak', icon: '🔥', text: '今天好忙！' }
      if (c.focusState === 'focused') return { action: 'happy' }
      return { action: 'speak', icon: '📋', text: '已记录' }
    }
  },

  reactTyping: {
    priority: (s, c) => s.isTyping ? 0.8 : 0,
    execute: () => ({ action: 'typing' })
  },

  talkIdle: {
    priority: (s, c) => {
      if (c.activityLevel === 'away' && Math.random() < 0.01) return 0.6
      if (s.mood < 30) return 0.5
      if (s.boredom > 60) return 0.4
      return 0
    },
    execute: (s, c) => {
      const messages = []
      if (s.mood < 30) messages.push({ icon: '😢', text: '主人多陪我玩嘛~' })
      if (s.boredom > 60) messages.push({ icon: '😒', text: '好无聊啊...' })
      if (c.activityLevel === 'away') messages.push({ icon: '💭', text: '主人在忙什么呀？' })
      const hour = new Date().getHours()
      if (hour >= 23) messages.push({ icon: '😴', text: '夜深了，早点休息~' })
      if (hour >= 5 && hour < 9) messages.push({ icon: '🌅', text: '早上好呀~' })
      if (messages.length === 0) return null
      return { action: 'speak', ...messages[Math.floor(Math.random() * messages.length)] }
    }
  },

  edgeWalk: {
    priority: (s) => s.isWalking ? 0.9 : 0,
    execute: () => ({ action: 'walk' })
  },

  sleep: {
    priority: (s, c) => {
      if (c.activityLevel === 'away') return 0.7
      if (c.idleTime > 30000) return 0.5
      return 0
    },
    execute: () => ({ action: 'sleep' })
  },

  bored: {
    priority: (s) => s.boredom > 80 ? 0.6 : 0,
    execute: () => ({ action: 'bored' })
  }
}

// ====== Tick ======
let lastBehavior = null
let lastBehaviorTime = 0
const BEHAVIOR_COOLDOWN = 3000 // 同一行为 3s 内不重复触发（idle 除外）

function tick() {
  // 检测日期变更，重置今日计数
  const today = new Date().toDateString()
  if (today !== context.lastCountDate) {
    context.clipboardCount = 0
    context.lastCountDate = today
  }

  updateContext()

  // 更新无聊度
  state.boredom = Math.min(100, context.idleTime / 600)

  // 选择行为
  let best = null
  let bestScore = -1
  for (const [name, behavior] of Object.entries(behaviors)) {
    const score = behavior.priority(state, context)
    if (score > bestScore) { bestScore = score; best = behavior }
  }

  if (!best) best = behaviors.idle

  // 行为变化时发出事件（idle 允许重复，其他行为需要冷却）
  const result = best.execute(state, context)
  const now = Date.now()
  const isIdle = best === behaviors.idle
  const changed = best !== lastBehavior
  const cooledDown = now - lastBehaviorTime > BEHAVIOR_COOLDOWN

  if (result && (changed || (isIdle && cooledDown))) {
    lastBehavior = best
    lastBehaviorTime = now
    eventBus.emit(Events.PET_BEHAVIOR, result, 'pet-engine')
  }
}

// ====== Event Handlers ======
function init() {
  // 用户活跃
  eventBus.on(Events.USER_ACTIVE, () => {
    state.lastInteraction = Date.now()
    state.boredom = Math.max(0, state.boredom - 20)
  }, 'pet-engine')

  // 用户空闲
  eventBus.on(Events.USER_IDLE, () => {
    addRecentAction('idle')
  }, 'pet-engine')

  // 打字
  let typingTimer = null
  eventBus.on(Events.USER_TYPING, () => {
    state.isTyping = true
    state.lastInteraction = Date.now()
    addRecentAction('typing')
    clearTimeout(typingTimer)
    typingTimer = setTimeout(() => { state.isTyping = false }, 3000)
  }, 'pet-engine')

  // 剪贴板
  eventBus.on(Events.CLIPBOARD_TEXT, () => {
    state.mood = Math.min(100, state.mood + 3)
    state.lastInteraction = Date.now()
    context.lastClipboardTime = Date.now()
    context.clipboardCount++
    addRecentAction('clipboard')
  }, 'pet-engine')

  eventBus.on(Events.CLIPBOARD_IMAGE, () => {
    state.mood = Math.min(100, state.mood + 3)
    state.lastInteraction = Date.now()
    context.lastClipboardTime = Date.now()
    context.clipboardCount++
    addRecentAction('clipboard')
  }, 'pet-engine')

  // 收藏
  eventBus.on(Events.DB_FAVORITE, () => {
    state.mood = Math.min(100, state.mood + 5)
    addRecentAction('favorite')
  }, 'pet-engine')

  // 心情衰减
  const moodTimer = setInterval(() => {
    if (!state.isWalking) {
      state.mood = Math.max(0, state.mood - 1)
      eventBus.emit(Events.PET_MOOD, { mood: state.mood }, 'pet-engine')
    }
  }, MOOD_DECAY_INTERVAL)

  // Tick
  const tickTimer = setInterval(tick, TICK_INTERVAL)

  // 应用退出时清理定时器
  eventBus.on(Events.APP_QUIT, () => {
    clearInterval(moodTimer)
    clearInterval(tickTimer)
  }, 'pet-engine')
}

// ====== API ======
function getState() { return { ...state } }
function getContext() { return { ...context } }
function addMood(n) { state.mood = Math.max(0, Math.min(100, state.mood + n)) }
function setWalking(v) { state.isWalking = v; state.lastInteraction = Date.now() }
function setDragging(v) { if (v) state.lastInteraction = Date.now() }
function setMouseMove() { state.lastInteraction = Date.now() }

module.exports = { init, getState, getContext, addMood, setWalking, setDragging, setMouseMove }

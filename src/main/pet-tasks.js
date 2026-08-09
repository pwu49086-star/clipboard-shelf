/**
 * Pet Tasks - 每日任务 + 皮肤解锁
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const { eventBus, Events } = require('./core/event-bus')

let electronApp = null
try { electronApp = require('electron').app } catch {}

const TASKS = [
  { key: 'copy5', name: '复制小达人', desc: '今日复制 5 次', countKey: 'copy', need: 5, skin: 'snow' },
  { key: 'ocr1', name: '火眼金睛', desc: '今日 OCR 识别 1 次', countKey: 'ocr', need: 1, skin: 'gold' },
  { key: 'screenshot1', name: '咔嚓一下', desc: '今日截图 1 次', countKey: 'screenshot', need: 1, skin: 'mint' },
  { key: 'favorite1', name: '收藏家', desc: '今日收藏 1 条', countKey: 'favorite', need: 1, skin: 'lava' },
  { key: 'palette1', name: '指挥家', desc: '今日打开命令面板 1 次', countKey: 'palette', need: 1, skin: 'nebula' },
]

const SKINS = [
  { id: 'default', name: '史莱姆·原版', desc: '初始皮肤' },
  { id: 'snow', name: '冰雪史莱姆', desc: '完成「复制小达人」解锁' },
  { id: 'gold', name: '黄金史莱姆', desc: '完成「火眼金睛」解锁' },
  { id: 'mint', name: '薄荷史莱姆', desc: '完成「咔嚓一下」解锁' },
  { id: 'lava', name: '熔岩史莱姆', desc: '完成「收藏家」解锁' },
  { id: 'nebula', name: '星云史莱姆', desc: '完成「指挥家」解锁' },
]

let state = null

function filePath() {
  if (process.env.PET_TASKS_FILE) return process.env.PET_TASKS_FILE
  try {
    if (electronApp) return path.join(electronApp.getPath('userData'), 'pet-tasks.json')
  } catch {
    return path.join(os.tmpdir(), 'pet-tasks.json')
  }
  return path.join(os.tmpdir(), 'pet-tasks.json')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function freshState() {
  return {
    date: today(),
    counts: { copy: 0, ocr: 0, screenshot: 0, favorite: 0, palette: 0 },
    done: {},
    unlocked: ['default'],
    points: 0
  }
}

function load() {
  try {
    state = JSON.parse(fs.readFileSync(filePath(), 'utf-8'))
  } catch { state = null }
  if (!state || state.date !== today()) {
    state = freshState()
    save()
  }
}

function save() {
  try { fs.writeFileSync(filePath(), JSON.stringify(state, null, 2)) } catch {}
}

function getState() {
  if (!state) load()
  return JSON.parse(JSON.stringify({ ...state, tasks: TASKS, skins: SKINS }))
}

function bump(key, inc = 1) {
  if (!state) load()
  state.counts[key] = (state.counts[key] || 0) + inc
  const completed = []
  for (const t of TASKS) {
    if (!state.done[t.key] && (state.counts[t.countKey] || 0) >= t.need) {
      state.done[t.key] = true
      state.points++
      if (t.skin && !state.unlocked.includes(t.skin)) state.unlocked.push(t.skin)
      completed.push(t)
    }
  }
  save()
  for (const t of completed) {
    eventBus.emit(Events.PET_TASK_DONE, { task: t.key, name: t.name, skin: t.skin })
  }
  return getState()
}

function init() {
  load()
  eventBus.on(Events.CLIPBOARD_TEXT, () => bump('copy'), 'pet-tasks')
  eventBus.on(Events.CLIPBOARD_IMAGE, () => bump('copy'), 'pet-tasks')
  eventBus.on(Events.OCR_DONE, () => bump('ocr'), 'pet-tasks')
  eventBus.on(Events.DB_FAVORITE, () => bump('favorite'), 'pet-tasks')
  eventBus.on(Events.SCREENSHOT, () => bump('screenshot'), 'pet-tasks')
}

module.exports = { init, bump, getState, TASKS, SKINS }

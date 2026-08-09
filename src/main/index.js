/**
 * Clipboard Shelf V3 - 主进程入口
 *
 * 架构: Event Bus + Services + Pet Engine
 * main 只做 orchestration，不做 logic
 */

const { app, BrowserWindow, globalShortcut, screen, ipcMain, dialog, protocol, net, Notification } = require('electron')
const path = require('path')
const fs = require('fs')

// 固定 userData 目录，避免 productName 变化导致数据目录漂移（%APPDATA%\clipboard-shelf）
app.setPath('userData', path.join(app.getPath('appData'), 'clipboard-shelf'))

// ====== 自动更新（仅打包版生效） ======
let autoUpdater = null
try {
  autoUpdater = require('electron-updater').autoUpdater
} catch {}

function setupAutoUpdater() {
  if (!app.isPackaged || !autoUpdater) return
  autoUpdater.autoDownload = false
  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `Clipboard Shelf 有新版 ${info.version}，是否下载？`,
      buttons: ['下载', '稍后'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate()
    }).catch(() => {})
  })
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: '更新已就绪',
      message: '新版本已下载，是否重启安装？',
      buttons: ['重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    }).catch(() => {})
  })
  autoUpdater.checkForUpdates().catch(() => {})
}

// ====== Services (loaded before crash handler to avoid TDZ) ======
const db = require('./services/db-service')
const clipboardPipeline = require('./services/clipboard-pipeline')
const ocrService = require('./services/ocr-service')
const petEngine = require('./pet/pet-engine')
const petTasks = require('./pet-tasks')

// ====== Crash Log ======
const logPath = path.join(app.getPath('userData'), 'crash.log')
function appendCrashLog(text) {
  try {
    const MAX_LOG_SIZE = 1024 * 1024 // 1MB
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_SIZE) {
      fs.renameSync(logPath, logPath + '.old')
    }
    fs.appendFileSync(logPath, text)
  } catch {}
}
process.on('uncaughtException', (err) => {
  appendCrashLog(`[${new Date().toISOString()}] UNCAUGHT: ${err.stack || err}\n`)
  // 紧急保存数据库，防止数据丢失
  try { db.close() } catch {}
  // 未捕获异常后进程状态不可靠，记录后退出
  try {
    dialog.showErrorBox(
      'Clipboard Shelf 发生错误',
      `发生未捕获异常：\n${err.message || err}\n\n程序即将退出，历史数据已保存。\n详细信息见 crash.log`
    )
  } catch {}
  app.exit(1)
})
process.on('unhandledRejection', (reason) => {
  appendCrashLog(`[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}\n`)
})

// ====== Core ======
const { eventBus, Events } = require('./core/event-bus')

// ====== Memory System ======
const memoryStore = require('./memory/memory-store')
const memorySearch = require('./memory/memory-search')
const memoryTimeline = require('./memory/memory-timeline')

// ====== Config ======
const configPath = path.join(app.getPath('userData'), 'config.json')
let config = {}
try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) } catch {}
function saveConfig() {
  try {
    const tmp = configPath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2))
    fs.renameSync(tmp, configPath)
  } catch (err) {
    console.error('[Config] Save error:', err)
  }
}

function registerHotkeys() {
  const h = config.hotkeys || { toggle: 'Ctrl+Alt+Space', palette: 'Ctrl+Alt+K' }
  globalShortcut.unregisterAll()
  let ok = true
  try {
    if (!globalShortcut.register(h.toggle, () => { if (isPetMode) switchToMainMode(); else switchToPetMode() })) ok = false
    if (!globalShortcut.register(h.palette, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (isPetMode) switchToMainMode()
        mainWindow.webContents.send('palette:toggle')
      }
    })) ok = false
  } catch { ok = false }
  return ok
}

// ====== Window State ======
let mainWindow = null
let petWindow = null
let isPetMode = false
let switching = false
let switchGeneration = 0
let petPosition = config.petPosition || null

const MAIN_WIDTH = 480
const MAIN_HEIGHT = 560
const PET_SIZE = 84
let lastSwitchTime = 0
const SWITCH_COOLDOWN = 500

// ====== 多显示器 ======
function displayForPoint(x, y) {
  return screen.getAllDisplays().find(d =>
    x >= d.bounds.x && x < d.bounds.x + d.bounds.width &&
    y >= d.bounds.y && y < d.bounds.y + d.bounds.height
  ) || screen.getPrimaryDisplay()
}

function displayForCenter(bounds) {
  return displayForPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

function initialMainBounds() {
  const cursor = screen.getCursorScreenPoint()
  const d = displayForPoint(cursor.x, cursor.y)
  return {
    width: MAIN_WIDTH, height: MAIN_HEIGHT,
    x: d.workArea.x + d.workArea.width - MAIN_WIDTH - 40,
    y: Math.round(d.workArea.y + (d.workArea.height - MAIN_HEIGHT) / 2)
  }
}

// ====== Window Animation ======
function fadeIn(win, duration = 150) {
  if (!win || win.isDestroyed()) return
  if (!win.isVisible()) win.show()
  const steps = 8
  const interval = duration / steps
  let step = 0
  win.setOpacity(0)
  const timer = setInterval(() => {
    step++
    if (step >= steps || !win || win.isDestroyed()) {
      clearInterval(timer)
      if (win && !win.isDestroyed()) win.setOpacity(1)
      return
    }
    win.setOpacity(step / steps)
  }, interval)
}

function fadeOut(win, duration = 120) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) { resolve(); return }
    const steps = 6
    const interval = duration / steps
    let step = steps
    const timer = setInterval(() => {
      step--
      if (step <= 0 || !win || win.isDestroyed()) {
        clearInterval(timer)
        if (win && !win.isDestroyed()) { win.setOpacity(0); win.hide(); win.setOpacity(1) }
        resolve()
        return
      }
      win.setOpacity(step / steps)
    }, interval)
  })
}

// ====== Main Window ======
function createWindow() {
  const savedBounds = (() => {
    if (config.mainBounds) {
      const d = displayForCenter(config.mainBounds)
      const wa = d.workArea
      const w = Math.min(config.mainBounds.width, wa.width)
      const h = Math.min(config.mainBounds.height, wa.height)
      const x = Math.max(wa.x, Math.min(config.mainBounds.x, wa.x + wa.width - w))
      const y = Math.max(wa.y, Math.min(config.mainBounds.y, wa.y + wa.height - h))
      return { width: w, height: h, x, y }
    }
    return initialMainBounds()
  })()

  mainWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    x: savedBounds.x,
    y: savedBounds.y,
    show: false,
    frame: false,
    resizable: true,
    minWidth: 360,
    minHeight: 300,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.setOpacity(0)
    mainWindow.show()
    fadeIn(mainWindow)
    mainWindow.focus()
  })

  let boundsSaveTimer = null
  const scheduleBoundsSave = () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(() => {
      boundsSaveTimer = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        config.mainBounds = mainWindow.getBounds()
        saveConfig()
      }
    }, 500)
  }
  mainWindow.on('resize', scheduleBoundsSave)
  mainWindow.on('move', scheduleBoundsSave)

  // 鼠标离开窗口自动缩回
  let outCount = 0
  let collapseTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || isPetMode || switching) return
    if (mainWindow._pinned) return
    try {
      const cursor = screen.getCursorScreenPoint()
      const bounds = mainWindow.getBounds()
      const inside = cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width &&
                     cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height
      if (!inside) {
        outCount++
        if (outCount >= 3) { outCount = 0; switchToPetMode() }
      } else {
        outCount = 0
      }
    } catch {}
  }, 500)

  mainWindow.on('closed', () => {
    mainWindow = null
    if (collapseTimer) { clearInterval(collapseTimer); collapseTimer = null }
  })

  if (!config.mainBounds) {
    config.mainBounds = savedBounds
    saveConfig()
  }

  return mainWindow
}

// ====== Pet Window ======
function createPetWindow() {
  const pos = (() => {
    if (petPosition) {
      const d = displayForCenter({ ...petPosition, width: PET_SIZE, height: PET_SIZE })
      const wa = d.workArea
      return {
        x: Math.max(wa.x, Math.min(petPosition.x, wa.x + wa.width - PET_SIZE)),
        y: Math.max(wa.y, Math.min(petPosition.y, wa.y + wa.height - PET_SIZE))
      }
    }
    const cursor = screen.getCursorScreenPoint()
    const d = displayForPoint(cursor.x, cursor.y)
    return { x: d.workArea.x + d.workArea.width - PET_SIZE - 16, y: d.workArea.y + 16 }
  })()

  petWindow = new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    x: pos.x,
    y: pos.y,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/pet-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const petPath = app.isPackaged
    ? path.join(__dirname, '../renderer/pet.html')
    : path.join(__dirname, '../../src/renderer/pet.html')
  petWindow.loadFile(petPath)

  petWindow.webContents.once('did-finish-load', () => {
    if (config.petSkin && petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:setSkin', config.petSkin)
    }
  })

  petWindow.on('closed', () => { petWindow = null; stopMouseTracking() })
  return petWindow
}

// ====== Mode Switching ======
function switchToPetMode() {
  const now = Date.now()
  if (isPetMode || switching || !mainWindow) return
  if (now - lastSwitchTime < SWITCH_COOLDOWN) return
  lastSwitchTime = now
  const gen = ++switchGeneration
  switching = true
  isPetMode = true
  fadeOut(mainWindow)

  if (!petWindow || petWindow.isDestroyed()) createPetWindow()
  petWindow.setOpacity(0)
  petWindow.show()
  fadeIn(petWindow)
  startMouseTracking()
  setTimeout(() => { if (gen === switchGeneration) switching = false }, SWITCH_COOLDOWN)

  eventBus.emit(Events.WINDOW_HIDE)
}

function switchToMainMode() {
  const now = Date.now()
  if (!isPetMode || switching) return
  if (now - lastSwitchTime < SWITCH_COOLDOWN) return
  lastSwitchTime = now
  const gen = ++switchGeneration
  switching = true
  isPetMode = false
  stopMouseTracking()

  fadeOut(petWindow)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.setOpacity(0)
    fadeIn(mainWindow)
    mainWindow.focus()
    mainWindow.webContents.send('window:focus')
  }
  setTimeout(() => { if (gen === switchGeneration) switching = false }, SWITCH_COOLDOWN)

  eventBus.emit(Events.WINDOW_SHOW)
  eventBus.emit(Events.USER_ACTIVE)
}

// ====== Mouse Tracking ======
let mouseTimer = null
let hoverStartTime = 0
const HOVER_DELAY = 800

function startMouseTracking() {
  if (mouseTimer) return
  hoverStartTime = 0
  mouseTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !isPetMode) { stopMouseTracking(); return }
    try {
      const cursor = screen.getCursorScreenPoint()
      const pb = petWindow.getBounds()
      const margin = 30
      const inside = cursor.x >= pb.x - margin && cursor.x <= pb.x + pb.width + margin &&
                     cursor.y >= pb.y - margin && cursor.y <= pb.y + pb.height + margin
      if (inside) {
        if (!hoverStartTime) hoverStartTime = Date.now()
        if (Date.now() - hoverStartTime >= HOVER_DELAY) {
          switchToMainMode()
        }
      } else {
        hoverStartTime = 0
      }
    } catch {}
  }, 100)
}

function stopMouseTracking() {
  if (mouseTimer) { clearInterval(mouseTimer); mouseTimer = null }
}

// ====== IPC Handlers ======
function setupIPC() {
  // Single instance lock: prevent duplicate launches
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  }
  // 宠物模式
  ipcMain.on('pet:minimize', () => switchToPetMode())
  ipcMain.on('pet:expand', () => switchToMainMode())

  // 宠物鼠标进入/离开（辅助鼠标跟踪）
  ipcMain.on('pet:mouseEnter', () => {
    hoverStartTime = Date.now()
  })
  ipcMain.on('pet:mouseLeave', () => {
    hoverStartTime = 0
  })
  ipcMain.on('pet:move', (e, pos) => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.setPosition(pos.x, pos.y)
  })
  ipcMain.on('pet:savePosition', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      const [x, y] = petWindow.getPosition()
      petPosition = { x, y }
      config.petPosition = { x, y }
      saveConfig()
    }
  })
  ipcMain.on('pet:copyItem', (e, item) => {
    clipboardPipeline.skipNextCopy()
    const { clipboard } = require('electron')
    clipboard.writeText(item.content)
  })
  ipcMain.handle('pet:getRecent', (e, limit) => {
    return db.getAll({ limit })
  })
  ipcMain.on('pet:clear', () => {
    db.clearNonFavorites()
  })
  ipcMain.on('pet:pin', (e, pinned) => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.setMovable(!pinned)
  })
  ipcMain.on('pet:quit', () => app.quit())

  // 聚焦搜索
  ipcMain.on('pet:focusSearch', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:focusSearch')
    }
  })

  // 皮肤切换
  ipcMain.on('pet:setSkin', (e, skin) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:setSkin', skin)
    }
  })
  ipcMain.on('pet:setCustomColors', (e, c1, c2) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:setCustomColors', c1, c2)
    }
  })
  ipcMain.on('pet:notifyFavorite', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:favorite')
    }
  })

  // 拖拽导入
  ipcMain.on('pet:importImage', (e, base64, filename) => {
    const ipc = require('./ipc-handlers')
    ipc.handleImportImage(base64, filename)
  })
  ipcMain.on('pet:importText', (e, text) => {
    const ipc = require('./ipc-handlers')
    ipc.handleImportText(text)
  })

  // 吃掉删除
  ipcMain.on('pet:eatItem', (e, id) => {
    const item = db.remove(id)
    if (item) {
      if (item.filePath) try { fs.unlinkSync(item.filePath) } catch {}
      if (item.thumbPath) try { fs.unlinkSync(item.thumbPath) } catch {}
    }
    eventBus.emit(Events.DB_DELETE, { id })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard:update', { id, _deleted: true })
    }
  })

  // 边缘吸附
  ipcMain.on('pet:snapToEdge', () => {
    if (!petWindow || petWindow.isDestroyed()) return
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    const [x, y] = petWindow.getPosition()
    const snap = 20
    let nx = x, ny = y
    if (x < snap) nx = 0
    else if (x + PET_SIZE > sw - snap) nx = sw - PET_SIZE
    if (y < snap) ny = 0
    else if (y + PET_SIZE > sh - snap) ny = sh - PET_SIZE
    if (nx !== x || ny !== y) {
      petWindow.setPosition(nx, ny)
      petPosition = { x: nx, y: ny }
      config.petPosition = { x: nx, y: ny }
      saveConfig()
    }
  })

  // 桌面行走
  ipcMain.on('pet:walk', (e, dir) => {
    if (!petWindow || petWindow.isDestroyed()) return
    const { width: sw } = screen.getPrimaryDisplay().workAreaSize
    const [x] = petWindow.getPosition()
    const speed = 2
    let nx = x + dir * speed
    let hitEdge = false
    if (nx <= 0) { nx = 0; hitEdge = true }
    else if (nx >= sw - PET_SIZE) { nx = sw - PET_SIZE; hitEdge = true }
    petWindow.setPosition(nx, petWindow.getPosition()[1])
    if (hitEdge) petWindow.webContents.send('pet:walkResult', { hitEdge: true })
  })

  // Memory IPC
  ipcMain.handle('memory:search', (e, query) => {
    return memorySearch.smartSearch(query)
  })
  ipcMain.handle('memory:quickSearch', (e, type) => {
    return memorySearch.quickSearch(type)
  })
  ipcMain.handle('memory:todayTimeline', () => {
    return memoryTimeline.getTodayTimeline()
  })
  ipcMain.handle('memory:todaySummary', () => {
    return memoryTimeline.getTodaySummary()
  })
  ipcMain.handle('memory:stats', () => {
    return memoryTimeline.getActivityStats()
  })
  ipcMain.handle('memory:petFeedback', () => {
    return memoryTimeline.getPetFeedback()
  })

  // Event Log (debug)
  ipcMain.handle('debug:eventLog', (e, limit) => {
    return eventBus.getEventLog(limit)
  })

  // 全局快捷键
  registerHotkeys()

  // 快捷键设置
  ipcMain.handle('settings:getHotkeys', () => config.hotkeys || { toggle: 'Ctrl+Alt+Space', palette: 'Ctrl+Alt+K' })
  ipcMain.handle('settings:setHotkey', (e, key, value) => {
    if (key !== 'toggle' && key !== 'palette') return { error: '无效的快捷键类型' }
    const accel = String(value || '').trim()
    if (!accel || !/^(Ctrl|Alt|Shift|Super)\+/.test(accel)) return { error: '快捷键格式无效（至少需要一个修饰键，如 Ctrl+Alt+K）' }
    const defaults = { toggle: 'Ctrl+Alt+Space', palette: 'Ctrl+Alt+K' }
    const next = { ...defaults, ...(config.hotkeys || {}), [key]: accel }
    if (next.toggle === next.palette) return { error: '两个快捷键不能相同' }
    const old = config.hotkeys || {}
    config.hotkeys = next
    saveConfig()
    if (!registerHotkeys()) {
      config.hotkeys = old
      saveConfig()
      registerHotkeys()
      return { error: '快捷键注册失败，可能被其他程序占用' }
    }
    return { ok: true }
  })

  // 宠物任务
  ipcMain.handle('tasks:getState', () => petTasks.getState())
  ipcMain.handle('tasks:bump', (e, key) => petTasks.bump(key))
  ipcMain.handle('tasks:selectSkin', (e, skin) => {
    const st = petTasks.getState()
    if (!st.unlocked.includes(skin)) return { error: '皮肤未解锁' }
    config.petSkin = skin
    saveConfig()
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:setSkin', skin)
    return { ok: true }
  })
}

// ====== Event Bus Wiring ======
function sendToPet(channel, data) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send(channel, data)
  }
}

function wireEvents() {
  // 宠物行为 → 通知宠物窗口
  eventBus.on(Events.PET_BEHAVIOR, (behavior) => sendToPet('pet:behavior', behavior))

  // 剪贴板新内容 → 通知 UI + 宠物
  eventBus.on(Events.DB_INSERT, (item) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard:update', item)
    }
    sendToPet('pet:clipboard', item)
  })

  // OCR 完成 → 宠物反应
  eventBus.on(Events.OCR_DONE, (data) => {
    sendToPet('pet:ocr-done', data)
  })

  // 删除 → 宠物反应
  eventBus.on(Events.DB_DELETE, (data) => {
    sendToPet('pet:delete', data)
  })

  // 收藏 → 宠物反应
  eventBus.on(Events.DB_FAVORITE, (data) => {
    sendToPet('pet:favorite', data)
  })

  // 任务完成 → 宠物庆祝
  eventBus.on(Events.PET_TASK_DONE, (data) => {
    sendToPet('pet:task-done', data)
  })
}

// ====== App Lifecycle ======
// 注册安全的本地文件协议，替代 webSecurity: false
protocol.registerSchemesAsPrivileged([
  { scheme: 'shelf-file', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } }
])
let imagesDirGlobal = ''

app.whenReady().then(async () => {
  // shelf-file://thumb/filename.png → 从 imagesDir/thumb/ 提供文件
  // shelf-file://full/filename.png → 从 imagesDir/full/ 提供文件
  protocol.handle('shelf-file', (request) => {
    const url = request.url.replace('shelf-file://', '')
    const [subdir, ...rest] = url.split('/')
    const filename = rest.join('/')
    const allowedDirs = ['thumb', 'full']
    if (!allowedDirs.includes(subdir) || !filename) {
      return new Response('Not found', { status: 404 })
    }
    const filePath = path.join(imagesDirGlobal, subdir, filename)
    // 安全检查：确保路径在 imagesDir 内
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(imagesDirGlobal))) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch('file:///' + resolved)
  })
  // 初始化服务
  await db.init()
  ocrService.init()
  petEngine.init()
  petTasks.init()

  // 初始化 Memory 系统
  memoryStore.init()
  memoryTimeline.init()

  // 从 DB 加载历史数据到 Memory
  const allItems = db.getAll({ limit: 5000 })
  memoryStore.loadFromDB(allItems)

  // 设置剪贴板监听
  const imagesDir = path.join(app.getPath('userData'), 'images')
  imagesDirGlobal = imagesDir
  clipboardPipeline.setImageDir(imagesDir)

  // 设置 IPC
  setupIPC()
  wireEvents()

  // 设置主 IPC handlers (items:getAll, items:delete, etc.)
  const ipcHandlers = require('./ipc-handlers')
  ipcHandlers.setImagesDir(imagesDir)

  // 创建窗口
  const win = createWindow()
  ipcHandlers.setup(win)
  ipcHandlers.setupPinHandlers()

  // 设置托盘
  const tray = require('./tray')
  tray.setup(win)

  // 启动剪贴板监听（先加载已有数据去重）
  clipboardPipeline.loadFromDB(db.getAll({ limit: 5000 }))
  clipboardPipeline.start()

  // 清理旧数据
  const deleted = db.cleanOld(2000)
  for (const row of deleted) {
    if (row.filePath) try { fs.unlinkSync(row.filePath) } catch {}
    if (row.thumbPath) try { fs.unlinkSync(row.thumbPath) } catch {}
  }

  eventBus.emit(Events.APP_READY)

  setupAutoUpdater()

  // 便签定时提醒（主进程通知，窗口隐藏也能弹）
  const reminderTimer = setInterval(() => {
    try {
      const due = db.getDueReminders(Date.now())
      for (const n of due) {
        if (Notification.isSupported()) {
          const body = (n.title || '').trim() || (n.content || '').slice(0, 60)
          const notif = new Notification({ title: 'Clipboard Shelf 便签提醒', body })
          notif.on('click', () => {
            if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() }
          })
          notif.show()
        }
        db.markNoteReminded(n.id)
      }
    } catch {}
  }, 30000)
  app.on('will-quit', () => { clearInterval(reminderTimer) })
})

app.on('window-all-closed', (e) => e.preventDefault())
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  clipboardPipeline.stop()
  db.close()
  eventBus.emit(Events.APP_QUIT)
})
app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus() }
})

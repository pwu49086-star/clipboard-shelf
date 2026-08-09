/**
 * Clipboard Shelf V3 - 主进程入口
 *
 * 架构: Event Bus + Services + Pet Engine
 * main 只做 orchestration，不做 logic
 */

const { app, BrowserWindow, globalShortcut, screen, ipcMain, dialog, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')

// ====== Services (loaded before crash handler to avoid TDZ) ======
const db = require('./services/db-service')
const clipboardPipeline = require('./services/clipboard-pipeline')
const ocrService = require('./services/ocr-service')
const petEngine = require('./pet/pet-engine')

// ====== Crash Log ======
const logPath = path.join(app.getPath('userData'), 'crash.log')
process.on('uncaughtException', (err) => {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] UNCAUGHT: ${err.stack || err}\n`)
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
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}\n`)
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
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const savedBounds = config.mainBounds || {
    width: MAIN_WIDTH, height: MAIN_HEIGHT,
    x: screenWidth - MAIN_WIDTH - 40,
    y: Math.round((screenHeight - MAIN_HEIGHT) / 2)
  }

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
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const pos = petPosition || {
    x: screenWidth - PET_SIZE - 16,
    y: 16
  }

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
  const ret = globalShortcut.register('Ctrl+Alt+Space', () => {
    if (isPetMode) switchToMainMode()
    else switchToPetMode()
  })
  if (!ret) {
    dialog.showMessageBox({
      type: 'warning',
      title: '快捷键注册失败',
      message: 'Ctrl+Alt+Space 快捷键注册失败',
      detail: '可能被其他占用，可通过托盘图标打开。',
      buttons: ['知道了']
    })
  }
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

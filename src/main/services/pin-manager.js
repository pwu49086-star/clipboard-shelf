/**
 * Pin Manager - 钉图管理
 * 
 * 管理所有钉在桌面的图片窗口
 */
const { app, BrowserWindow, screen, ipcMain, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const pinnedWindows = new Map() // id → BrowserWindow
let nextPinId = 1

function createPinWindow(imagePath, x, y) {
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = display.workAreaSize
  
  // 获取图片尺寸
  const img = nativeImage.createFromPath(imagePath)
  const size = img.getSize()
  const maxDim = 300
  const scale = Math.min(maxDim / size.width, maxDim / size.height, 1)
  const w = Math.round(size.width * scale)
  const h = Math.round(size.height * scale)
  
  // 默认位置：屏幕右上角，避免重叠
  const pinId = nextPinId++
  const offsetX = (pinId % 5) * 30
  const offsetY = Math.floor(pinId / 5) * 30
  const posX = x !== undefined ? x : sw - w - 20 - offsetX
  const posY = y !== undefined ? y : 20 + offsetY
  
  const win = new BrowserWindow({
    width: w,
    height: h,
    x: posX,
    y: posY,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    hasShadow: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  })
  
  // 加载钉图 HTML（打包版用 out/renderer，开发版用源码目录）
  const htmlPath = app.isPackaged
    ? path.join(__dirname, '../renderer/pin.html')
    : path.join(__dirname, '../../src/renderer/pin.html')
  win.loadFile(htmlPath)
  
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('pin:init', { id: pinId, imagePath, width: w, height: h })
  })
  
  win.on('closed', () => {
    pinnedWindows.delete(pinId)
  })
  
  pinnedWindows.set(pinId, win)
  return pinId
}

function closePin(pinId) {
  const win = pinnedWindows.get(pinId)
  if (win && !win.isDestroyed()) {
    win.close()
  }
}

function closeAllPins() {
  for (const [id, win] of pinnedWindows) {
    if (!win.isDestroyed()) win.close()
  }
  pinnedWindows.clear()
}

function setup() {
  // 钉图 IPC
  ipcMain.on('pin:create', (e, { imagePath, x, y }) => {
    if (imagePath && fs.existsSync(imagePath)) {
      createPinWindow(imagePath, x, y)
    }
  })
  
  ipcMain.on('pin:close', (e, { id }) => {
    closePin(id)
  })
  
  ipcMain.on('pin:closeAll', () => {
    closeAllPins()
  })
  
  // 钉图窗口的移动和缩放
  ipcMain.on('pin:move', (e, { id, x, y }) => {
    const win = pinnedWindows.get(id)
    if (win && !win.isDestroyed()) {
      win.setPosition(x, y)
    }
  })
  
  ipcMain.on('pin:resize', (e, { id, width, height }) => {
    const win = pinnedWindows.get(id)
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      win.setBounds({ x, y, width, height })
    }
  })
}

module.exports = { setup, createPinWindow, closePin, closeAllPins }

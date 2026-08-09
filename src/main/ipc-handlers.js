/**
 * IPC Handlers - UI 接口层
 *
 * 处理 renderer 进程的 IPC 调用
 * 通过 EventBus 与服务层通信
 */

const { ipcMain, clipboard, shell, desktopCapturer, nativeImage, app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { eventBus, Events } = require('./core/event-bus')
const db = require('./services/db-service')
const pinManager = require('./services/pin-manager')

// Config
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

let imagesDir = ''

function setImagesDir(dir) {
  imagesDir = dir
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function setup(mainWindow) {
  // 初始化钉图管理器
  pinManager.setup()

  // ====== 配置导入导出 ======
  ipcMain.handle('config:export', async () => {
    const { dialog } = require('electron')
    const savePath = dialog.showSaveDialogSync(mainWindow, {
      title: '导出配置',
      defaultPath: 'clipboard-shelf-backup-' + new Date().toISOString().slice(0,10) + '.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!savePath) return null
    try {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const favorites = db.getAll({ limit: 10000 }).filter(i => i.isFavorite === 1)
      const notes = db.getAllNotes()
      const exportData = {
        version: 1,
        exportTime: Date.now(),
        config: configData,
        favorites: favorites.map(f => {
          let imageBase64 = null
          if (f.type === 'image' && f.filePath && fs.existsSync(f.filePath)) {
            imageBase64 = fs.readFileSync(f.filePath).toString('base64')
          }
          return { type: f.type, content: f.content, ocrText: f.ocrText, imageBase64 }
        }),
        notes: notes.map(n => ({ title: n.title, content: n.content, color: n.color, isPinned: n.isPinned, remindAt: n.remindAt || null }))
      }
      fs.writeFileSync(savePath, JSON.stringify(exportData, null, 2), 'utf-8')
      return savePath
    } catch (e) { console.error('[ConfigExport] Error:', e); return null }
  })

  ipcMain.handle('config:import', async () => {
    const { dialog } = require('electron')
    const openPath = dialog.showOpenDialogSync(mainWindow, {
      title: '导入配置',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (!openPath || !openPath[0]) return null
    try {
      const data = JSON.parse(fs.readFileSync(openPath[0], 'utf-8'))
      if (!data.version) return { error: '无效的备份文件' }
      // 导入配置
      if (data.config) {
        Object.assign(config, data.config)
        saveConfig()
      }
      // 导入收藏
      let favCount = 0
      if (data.favorites && Array.isArray(data.favorites)) {
        for (const f of data.favorites) {
          const existing = db.getAll({ search: f.content, limit: 1 })
          if (existing.length === 0 && f.content) {
            let filePath = null
            let thumbPath = null
            if (f.type === 'image' && f.imageBase64) {
              const buffer = Buffer.from(f.imageBase64, 'base64')
              const name = `restore_${Date.now()}_${favCount}.png`
              const fullDir = path.join(imagesDir, 'full')
              const thumbDir = path.join(imagesDir, 'thumb')
              fs.mkdirSync(fullDir, { recursive: true })
              fs.mkdirSync(thumbDir, { recursive: true })
              filePath = path.join(fullDir, name)
              thumbPath = path.join(thumbDir, name)
              fs.writeFileSync(filePath, buffer)
              const img = nativeImage.createFromBuffer(buffer)
              if (!img.isEmpty()) fs.writeFileSync(thumbPath, img.resize({ width: 200 }).toPNG())
            }
            const item = db.insert({ type: f.type || 'text', content: f.content, ocrText: f.ocrText, filePath, thumbPath })
            if (item) { db.toggleFavorite(item.id); favCount++ }
          }
        }
      }
      // 导入便签
      let noteCount = 0
      if (data.notes && Array.isArray(data.notes)) {
        for (const n of data.notes) {
          db.insertNote({ title: n.title, content: n.content, color: n.color, remindAt: n.remindAt || null })
          noteCount++
        }
      }
      return { favCount, noteCount }
    } catch (e) { console.error('[ConfigImport] Error:', e); return { error: e.message } }
  })

  // 获取所有项目
  ipcMain.handle('items:getAll', (event, opts) => {
    const result = db.getAll(opts)
    // 搜索为空 → 通知宠物
    if (opts && opts.search && result.length === 0) {
      const allWindows = BrowserWindow.getAllWindows()
      for (const w of allWindows) {
        if (!w.isDestroyed() && w !== mainWindow) {
          w.webContents.send('pet:search-empty')
        }
      }
    }
    return result
  })

  // 批量删除项目
  ipcMain.handle('items:batchDelete', async (event, ids) => {
    for (const id of ids) {
      const item = db.remove(id)
      if (item) {
        if (item.filePath) try { fs.unlinkSync(item.filePath) } catch {}
        if (item.thumbPath) try { fs.unlinkSync(item.thumbPath) } catch {}
      }
      eventBus.emit(Events.DB_DELETE, { id })
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clipboard:update', { id, _deleted: true })
      }
    }
    return ids
  })

  // 删除项目
  ipcMain.handle('items:delete', (event, id) => {
    const item = db.remove(id)
    if (item) {
      if (item.filePath) try { fs.unlinkSync(item.filePath) } catch {}
      if (item.thumbPath) try { fs.unlinkSync(item.thumbPath) } catch {}
    }
    eventBus.emit(Events.DB_DELETE, { id })
    // 通知 renderer 增量删除
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard:update', { id, _deleted: true })
    }
    return id
  })

  // 切换收藏
  ipcMain.handle('items:toggleFavorite', (event, id) => {
    const result = db.toggleFavorite(id)
    if (result) {
      eventBus.emit(Events.DB_FAVORITE, { id, isFavorite: result.isFavorite })
    }
    return result
  })

  // 编辑文字
  ipcMain.handle('items:edit', (event, id, content) => {
    db.updateContent(id, content)
    eventBus.emit(Events.DB_UPDATE, { id, content })
    return true
  })

  // 复制到剪贴板
  ipcMain.handle('items:copy', (event, item) => {
    const watcher = require('./services/clipboard-pipeline')
    watcher.skipNextCopy()
    if (item.type === 'text') {
      clipboard.writeText(item.content)
    } else if (item.type === 'image' && item.filePath) {
      const img = nativeImage.createFromPath(item.filePath)
      clipboard.writeImage(img)
    }
    return true
  })

  // 拖拽文件
  ipcMain.handle('items:startDrag', (event, item) => {
    if (item.type === 'image' && item.filePath) {
      const tmpDir = path.join(os.tmpdir(), 'clipboard-shelf')
      fs.mkdirSync(tmpDir, { recursive: true })
      const ext = path.extname(item.filePath)
      const tmpFile = path.join(tmpDir, `clipboard${ext}`)
      fs.copyFileSync(item.filePath, tmpFile)
      event.sender.startDrag({
        file: tmpFile,
        icon: nativeImage.createFromPath(item.filePath).resize({ width: 64 })
      })
    }
  })

  // 在资源管理器中显示
  ipcMain.handle('items:showInExplorer', (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath)
  })

  // 用编辑器打开图片
  ipcMain.handle('items:openInEditor', async (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return
    const editorPath = app.isPackaged
      ? path.join(__dirname, '../renderer/editor.html')
      : path.join(__dirname, '../../src/renderer/editor.html')
    const { screen } = require('electron')
    const display = screen.getPrimaryDisplay()
    const ew = Math.min(display.workArea.width - 100, 1000)
    const eh = Math.min(display.workArea.height - 100, 700)
    const editorWin = new BrowserWindow({
      width: ew, height: eh, minWidth: 600, minHeight: 400, frame: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    })
    editorWin.loadFile(editorPath, { search: `?path=${encodeURIComponent(filePath)}` })

    const onSave = (e, { path: savePath, data }) => {
      // 路径校验：必须在 imagesDir 内
      const resolvedPath = path.resolve(savePath)
      if (!resolvedPath.startsWith(path.resolve(imagesDir))) {
        console.error('[Editor] Path traversal rejected:', savePath)
        return
      }
      const base64 = data.replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(resolvedPath, Buffer.from(base64, 'base64'))
      const thumbDir = path.join(imagesDir, 'thumb')
      const thumbPath = path.join(thumbDir, path.basename(resolvedPath))
      if (fs.existsSync(thumbDir)) {
        const nativeImg = nativeImage.createFromPath(resolvedPath)
        fs.writeFileSync(thumbPath, nativeImg.resize({ width: 200 }).toPNG())
      }
      editorWin.close()
    }
    const onCancel = () => editorWin.close()

    ipcMain.on('editor:save', onSave)
    ipcMain.on('editor:cancel', onCancel)

    // 窗口关闭时清理监听器
    editorWin.on('closed', () => {
      ipcMain.removeListener('editor:save', onSave)
      ipcMain.removeListener('editor:cancel', onCancel)
    })
  })

  // 窗口置顶
  ipcMain.handle('window:setAlwaysOnTop', (event, flag) => {
    mainWindow.setAlwaysOnTop(flag)
    mainWindow._pinned = flag
  })

  // 截图
  ipcMain.handle('window:screenshot', async () => {
    mainWindow.hide()
    await sleep(300)
    const { screen } = require('electron')
    const cursorPos = screen.getCursorScreenPoint()
    const allDisplays = screen.getAllDisplays()
    const targetDisplay = allDisplays.find(d => {
      const { x, y, width, height } = d.bounds
      return cursorPos.x >= x && cursorPos.x < x + width && cursorPos.y >= y && cursorPos.y < y + height
    }) || screen.getPrimaryDisplay()
    const { x: dx, y: dy, width: dw, height: dh } = targetDisplay.bounds
    const sf = targetDisplay.scaleFactor
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(allDisplays.reduce((max, d) => Math.max(max, d.bounds.x + d.bounds.width), 0) * sf),
        height: Math.round(allDisplays.reduce((max, d) => Math.max(max, d.bounds.y + d.bounds.height), 0) * sf)
      }
    })
    if (!sources.length) { mainWindow.show(); return null }
    let fullImg = sources[0].thumbnail
    if (sources.length > 1) {
      const matchedSource = sources.find(s => {
        const srcDisplay = allDisplays.find(d => String(d.id) === s.display_id)
        return srcDisplay && srcDisplay.id === targetDisplay.id
      })
      if (matchedSource) fullImg = matchedSource.thumbnail
    }
    const imgSize = fullImg.getSize()
    if (imgSize.width > dw * sf + 10 || imgSize.height > dh * sf + 10) {
      const minX = Math.min(...allDisplays.map(d => d.bounds.x))
      const minY = Math.min(...allDisplays.map(d => d.bounds.y))
      const cropBounds = {
        x: Math.round((dx - minX) * sf), y: Math.round((dy - minY) * sf),
        width: Math.round(dw * sf), height: Math.round(dh * sf)
      }
      try { fullImg = fullImg.crop(cropBounds) } catch {}
    }
    const overlay = new BrowserWindow({
      x: dx, y: dy, width: dw, height: dh, frame: false, transparent: true,
      alwaysOnTop: true, skipTaskbar: true, resizable: false,
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
    })
    const screenshotPath = app.isPackaged
      ? path.join(__dirname, '../renderer/screenshot.html')
      : path.join(__dirname, '../../src/renderer/screenshot.html')
    overlay.loadFile(screenshotPath)
    const { ipcMain: ipc2 } = require('electron')
        const onCapture = async (event, bounds) => {
      cleanup()
      const scaledBounds = {
        x: Math.round(bounds.x * sf), y: Math.round(bounds.y * sf),
        width: Math.round(bounds.width * sf), height: Math.round(bounds.height * sf)
      }
      const cropped = fullImg.crop(scaledBounds)
      fs.mkdirSync(path.join(imagesDir, 'full'), { recursive: true })
      fs.mkdirSync(path.join(imagesDir, 'thumb'), { recursive: true })
      const filename = 'screenshot_' + Date.now() + '.png'
      const thumbName = 'screenshot_' + Date.now() + '.jpg'
      const fullPath = path.join(imagesDir, 'full', filename)
      const thumbPath = path.join(imagesDir, 'thumb', thumbName)
      fs.writeFileSync(fullPath, cropped.toPNG())
      fs.writeFileSync(thumbPath, cropped.resize({ width: 200 }).toJPEG(80))
      const item = db.insert({
        type: 'image', content: filename, filePath: fullPath,
        thumbPath: thumbPath, ocrText: null, createTime: Date.now(),
        fileSize: fs.statSync(fullPath).size,
        imageWidth: cropped.getSize().width, imageHeight: cropped.getSize().height
      })
      if (item) {
        eventBus.emit(Events.DB_INSERT, item)
        eventBus.emit(Events.OCR_JOB, { filePath: fullPath, itemId: item.id })
      }
      overlay.close()
      mainWindow.show(); mainWindow.focus()
      setTimeout(function() { mainWindow.webContents.send('clipboard:update', { _ocrUpdated: true }) }, 1500)
    }
    const onCancel = () => { cleanup(); overlay.close(); mainWindow.show(); mainWindow.focus() }
    function cleanup() { ipc2.removeListener('screenshot:capture', onCapture); ipc2.removeListener('screenshot:cancel', onCancel) }
    ipc2.on('screenshot:capture', onCapture)
    ipc2.on('screenshot:cancel', onCancel)
    overlay.on('closed', () => { cleanup(); if (!mainWindow.isVisible()) { mainWindow.show(); mainWindow.focus() } })
  })

  // OCR
  ipcMain.handle('ocr:recognize', async (event, base64Data) => {
    const ocr = require('./services/ocr-service')
    try { return await ocr.recognizeBase64(base64Data) } catch (e) { return null }
  })

  // OCR by file path
  ipcMain.handle('ocr:recognizePath', async (event, filePath) => {
    const ocr = require('./services/ocr-service')
    try { return await ocr.recognize(filePath) } catch (e) { return null }
  })

  // Notes
  ipcMain.handle('notes:getAll', () => db.getAllNotes())
  ipcMain.handle('notes:create', (e, note) => db.insertNote(note))
  ipcMain.handle('notes:update', (e, id, changes) => { db.updateNote(id, changes); return true })
  ipcMain.handle('notes:delete', (e, id) => { db.deleteNote(id); return true })
  ipcMain.handle('notes:togglePin', (e, id) => { db.toggleNotePin(id); return true })

  // 导入图片
  ipcMain.handle('import:image', async (event, base64, filename) => {
    handleImportImage(base64, filename)
    return true
  })

  // 导入文字
  ipcMain.handle('import:text', async (event, text) => {
    handleImportText(text)
    return true
  })

  // 设置
  ipcMain.handle('settings:setAutoStart', (event, enabled) => { app.setLoginItemSettings({ openAtLogin: enabled }) })
  ipcMain.handle('settings:getAutoStart', () => app.getLoginItemSettings().openAtLogin)

  // 剪贴板读取（命令面板用）
  ipcMain.handle('clipboard:readText', () => clipboard.readText())

  // 打开外部文件夹（命令面板用）
  ipcMain.handle('system:openPath', (e, p) => {
    if (p && fs.existsSync(p)) { shell.openPath(p); return true }
    return false
  })

  // 清空非收藏（命令面板用）
  ipcMain.handle('items:clearNonFavorites', () => { db.clearNonFavorites(); return true })

  // Pet behaviors: read in main process (renderer has no file access)
  ipcMain.handle('pet:getBehaviors', () => {
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, 'behaviors.json')]
      : [path.resolve(__dirname, '../../resources/behaviors.json')]
    for (const p of candidates) {
      try { return fs.readFileSync(p, 'utf-8') } catch {}
    }
    return null
  })

  // 翻译
  ipcMain.handle('translate:text', async (event, text, from, to) => {
    if (!config.allowOnlineTranslate) {
      console.warn('[Translate] disabled (config.allowOnlineTranslate = false)')
      return null
    }
    if (config.aiApiKey) {
      try {
        const target = to === 'zh' ? 'Simplified Chinese' : 'English'
        const aiResult = await aiChat([{ role: 'system', content: 'You are a professional translator. Reply with only the translation, no explanations.' }, { role: 'user', content: `Translate the following text into ${target}:\n\n${text}` }], 2000)
        if (aiResult && aiResult.trim()) return aiResult.trim()
      } catch (e) { console.warn('[Translate] AI failed, fallback to online:', e.message) }
    }
    const { net } = require('electron')
    function fetchUrl(url, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const request = net.request(url)
        let body = ''
        const timer = setTimeout(() => {
          request.abort()
          reject(new Error('Request timeout'))
        }, timeoutMs)
        request.on('response', (response) => {
          response.on('data', (chunk) => { body += chunk.toString() })
          response.on('end', () => { clearTimeout(timer); resolve(body) })
        })
        request.on('error', (e) => { clearTimeout(timer); reject(e) })
        request.end()
      })
    }
    async function googleTranslate() {
      const safeFrom = encodeURIComponent(from).replace(/[^a-zA-Z-]/g, '')
      const safeTo = encodeURIComponent(to).replace(/[^a-zA-Z-]/g, '')
      // 使用更稳定的 API 端点
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${safeFrom}&tl=${safeTo}&dt=t&dt=rm&dj=1&q=${encodeURIComponent(text)}`
      const body = await fetchUrl(url)
      const data = JSON.parse(body)
      if (data && data.sentences) {
        return data.sentences.filter(s => s.trans).map(s => s.trans).join('')
      }
      // 兼容旧格式
      if (data && data[0]) return data[0].map(item => item[0]).join('')
      return null
    }
    async function myMemoryTranslate() {
      const safeFrom = encodeURIComponent(from).replace(/[^a-zA-Z-]/g, '')
      const safeTo = encodeURIComponent(to).replace(/[^a-zA-Z-]/g, '')
      // 分段翻译长文本，提高质量
      const chunks = text.match(/.{1,500}/g) || [text]
      const results = []
      for (const chunk of chunks) {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${safeFrom}|${safeTo}`
        const body = await fetchUrl(url)
        const data = JSON.parse(body)
        if (data.responseStatus === 200 && data.responseData) {
          results.push(data.responseData.translatedText)
        }
      }
      return results.length ? results.join('') : null
    }
    for (const engine of [{ name: 'Google', fn: googleTranslate }, { name: 'MyMemory', fn: myMemoryTranslate }]) {
      try {
        const result = await engine.fn()
        if (result && result.trim()) return result.trim()
      } catch (e) {}
    }
    return null
  })
}

// ====== AI (DeepSeek) ======
async function aiChat(messages, maxTokens = 2000) {
  const { net } = require('electron')
  const baseUrl = (config.aiBaseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
  const url = baseUrl + '/chat/completions'
  const body = JSON.stringify({ model: config.aiModel || 'deepseek-chat', messages, temperature: 0.3, max_tokens: maxTokens })
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (config.aiApiKey || '') } })
    let data = ''
    const timer = setTimeout(() => { req.abort(); reject(new Error('AI timeout')) }, 60000)
    req.on('response', (res) => {
      res.on('data', c => { data += c.toString() })
      res.on('end', () => { clearTimeout(timer); try { const j = JSON.parse(data); resolve((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || null) } catch (e) { reject(e) } })
    })
    req.on('error', (e) => { clearTimeout(timer); reject(e) })
    req.end(body)
  })
}

// AI 一键处理（翻译/总结/解释/工单）
ipcMain.handle('ai:process', async (event, payload) => {
  const { action, text } = payload || {}
  if (!text || !text.trim()) return { error: '没有可处理的文本' }
  if (!config.aiApiKey) return { error: '未配置 aiApiKey（config.json）' }
  const prompts = {
    translate: 'Translate the following text into Simplified Chinese if it is not Chinese, otherwise into English. Reply with only the translation.\n\n' + text,
    summary: '用简洁中文总结以下内容的要点，分点列出，不要遗漏关键信息。\n\n' + text,
    explain: '用通俗中文解释以下内容，适合空调维修技术人员理解。\n\n' + text,
    workorder: '根据以下内容生成一份中文维修工单草稿，包含：客户/机型/故障现象/可能原因/处理步骤/所需配件/备注，缺的字段留空。\n\n' + text
  }
  const prompt = prompts[action] || prompts.summary
  try {
    const result = await aiChat([{ role: 'user', content: prompt }], 2500)
    return result ? { text: result } : { error: 'AI 无返回' }
  } catch (e) {
    return { error: 'AI 请求失败: ' + e.message }
  }
})

// ====== Helper Functions ======
function handleImportImage(base64, filename) {
  const buffer = Buffer.from(base64, 'base64')
  const name = `import_${Date.now()}_${filename || 'image.png'}`
  const thumbName = name.replace(/\.(png|jpg|jpeg|bmp|gif|webp)$/i, '.jpg')
  const fullPath = path.join(imagesDir, 'full', name)
  const thumbPath = path.join(imagesDir, 'thumb', thumbName)
  fs.mkdirSync(path.join(imagesDir, 'full'), { recursive: true })
  fs.mkdirSync(path.join(imagesDir, 'thumb'), { recursive: true })
  fs.writeFileSync(fullPath, buffer)
  const nativeImg = nativeImage.createFromBuffer(buffer)
  if (!nativeImg.isEmpty()) {
    fs.writeFileSync(thumbPath, nativeImg.resize({ width: 200 }).toJPEG(80))
  }
  const stat = fs.statSync(fullPath)
  const size = nativeImg.getSize()
  const item = db.insert({
    type: 'image', content: name, filePath: fullPath,
    thumbPath: fs.existsSync(thumbPath) ? thumbPath : null,
    ocrText: null, createTime: Date.now(),
    fileSize: stat.size, imageWidth: size.width, imageHeight: size.height
  })
  if (item) eventBus.emit(Events.DB_INSERT, item)
}

function handleImportText(text) {
  if (text && text.trim()) {
    const item = db.insert({
      type: 'text', content: text, filePath: null, thumbPath: null,
      ocrText: null, createTime: Date.now()
    })
    if (item) eventBus.emit(Events.DB_INSERT, item)
  }
}


// ====== 标注窗口 ======
function openAnnotationWindow(imagePath, imgSize, onSave, onCancel) {
  const { screen } = require('electron')
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = display.workAreaSize

  const ew = Math.min(sw - 100, 1000)
  const eh = Math.min(sh - 100, 700)

  const editorWin = new BrowserWindow({
    width: ew, height: eh, minWidth: 600, minHeight: 400,
    frame: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })

  const editorPath = app.isPackaged
    ? path.join(__dirname, '../renderer/editor.html')
    : path.join(__dirname, '../../src/renderer/editor.html')
  editorWin.loadFile(editorPath, { search: '?path=' + encodeURIComponent(imagePath) })

  const { ipcMain: ipc2 } = require('electron')
  const onEditorSave = (e, { path: savePath, data }) => {
    cleanup()
    const base64 = data.replace(/^data:image\/png;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    editorWin.close()
    onSave(buffer)
  }
  const onEditorCancel = () => {
    cleanup()
    editorWin.close()
    onCancel()
  }
  function cleanup() {
    ipc2.removeListener('editor:save', onEditorSave)
    ipc2.removeListener('editor:cancel', onEditorCancel)
  }
  let handled = false
  const wrappedSave = (e, data) => { if (handled) return; handled = true; cleanup(); onEditorSave(e, data) }
  const wrappedCancel = () => { if (handled) return; handled = true; cleanup(); onEditorCancel() }
  ipc2.on('editor:save', wrappedSave)
  ipc2.on('editor:cancel', wrappedCancel)
  editorWin.on('closed', () => { if (!handled) { handled = true; cleanup(); onEditorCancel() } })
}

// ====== 钉图（从剪贴板历史） ======
function setupPinHandlers() {
  ipcMain.on('pin:fromHistory', (e, { filePath }) => {
    if (filePath && fs.existsSync(filePath)) {
      pinManager.createPinWindow(filePath)
    }
  })
}

module.exports = { setup, setImagesDir, handleImportImage, handleImportText, setupPinHandlers }

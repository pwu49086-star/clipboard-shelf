const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 获取所有项目
  getAll: (opts) => ipcRenderer.invoke('items:getAll', opts),

  // 删除
  deleteItem: (id) => ipcRenderer.invoke('items:delete', id),
  batchDeleteItems: (ids) => ipcRenderer.invoke('items:batchDelete', ids),

  // 切换收藏
  toggleFavorite: (id) => ipcRenderer.invoke('items:toggleFavorite', id),

  // 编辑文字内容
  editItem: (id, content) => ipcRenderer.invoke('items:edit', id, content),

  // 复制到剪贴板
  copyItem: (item) => ipcRenderer.invoke('items:copy', item),
  copyPlainText: (item) => ipcRenderer.invoke('items:copyPlainText', item),

  // 拖拽
  startDrag: (item) => ipcRenderer.invoke('items:startDrag', item),

  // 在资源管理器中显示
  showInExplorer: (filePath) => ipcRenderer.invoke('items:showInExplorer', filePath),

  // 用系统编辑器打开图片
  openInEditor: (filePath) => ipcRenderer.invoke('items:openInEditor', filePath),

  // 设置窗口置顶
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),

  // 截图
  screenshot: () => ipcRenderer.invoke('window:screenshot'),

  // 截图选区
  screenshotCapture: (bounds) => ipcRenderer.send('screenshot:capture', bounds),
  screenshotCancel: () => ipcRenderer.send('screenshot:cancel'),

  // OCR
  ocrRecognize: (base64Data) => ipcRenderer.invoke('ocr:recognize', base64Data),
  ocrRecognizePath: (filePath) => ipcRenderer.invoke('ocr:recognizePath', filePath),

  // 翻译
  translateText: (text, from, to) => ipcRenderer.invoke('translate:text', text, from, to),

  // AI 一键处理（翻译/总结/解释/工单）
  aiProcess: (payload) => ipcRenderer.invoke('ai:process', payload),

  // 命令面板
  readClipboardText: () => ipcRenderer.invoke('clipboard:readText'),
  exportMarkdown: (payload) => ipcRenderer.invoke('output:exportMarkdown', payload),
  openPath: (p) => ipcRenderer.invoke('system:openPath', p),
  clearHistory: () => ipcRenderer.invoke('items:clearNonFavorites'),
  getHotkeys: () => ipcRenderer.invoke('settings:getHotkeys'),
  setHotkey: (key, value) => ipcRenderer.invoke('settings:setHotkey', key, value),
  onPaletteToggle: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('palette:toggle', handler)
    return () => ipcRenderer.removeListener('palette:toggle', handler)
  },

  // 宠物任务
  tasksGetState: () => ipcRenderer.invoke('tasks:getState'),
  tasksBump: (key) => ipcRenderer.invoke('tasks:bump', key),
  tasksSelectSkin: (skin) => ipcRenderer.invoke('tasks:selectSkin', skin),

  // 主密码加密
  encryptionGetStatus: () => ipcRenderer.invoke('encryption:getStatus'),
  encryptionEnable: (pw) => ipcRenderer.invoke('encryption:enable', pw),
  encryptionUnlock: (pw) => ipcRenderer.invoke('encryption:unlock', pw),
  encryptionDisable: (pw) => ipcRenderer.invoke('encryption:disable', pw),
  encryptionLock: () => ipcRenderer.invoke('encryption:lock'),
  getCaptureOptions: () => ipcRenderer.invoke('settings:getCaptureOptions'),
  setCaptureOptions: (opts) => ipcRenderer.invoke('settings:setCaptureOptions', opts),
  getRetention: () => ipcRenderer.invoke('settings:getRetention'),
  setRetention: (policy) => ipcRenderer.invoke('settings:setRetention', policy),
  getPasteOptions: () => ipcRenderer.invoke('settings:getPasteOptions'),
  setPasteOptions: (opts) => ipcRenderer.invoke('settings:setPasteOptions', opts),

  // 关于 / 更新
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),

  // 数据统计
  statsOverview: () => ipcRenderer.invoke('stats:overview'),

  // 托盘命令
  onTrayCommand: (callback) => {
    const handler = (event, action) => callback(action)
    ipcRenderer.on('tray:command', handler)
    return () => ipcRenderer.removeListener('tray:command', handler)
  },

  // 开机自启
  setAutoStart: (enabled) => ipcRenderer.invoke('settings:setAutoStart', enabled),
  getAutoStart: () => ipcRenderer.invoke('settings:getAutoStart'),

  // 导入文件
  importImage: (base64, filename) => ipcRenderer.invoke('import:image', base64, filename),
  importText: (text) => ipcRenderer.invoke('import:text', text),

  // Memory 系统
  memorySearch: (query) => ipcRenderer.invoke('memory:search', query),
  memoryQuickSearch: (type) => ipcRenderer.invoke('memory:quickSearch', type),
  memoryTodayTimeline: () => ipcRenderer.invoke('memory:todayTimeline'),
  memoryTodaySummary: () => ipcRenderer.invoke('memory:todaySummary'),
  memoryStats: () => ipcRenderer.invoke('memory:stats'),
  memoryPetFeedback: () => ipcRenderer.invoke('memory:petFeedback'),

  // 便签
  notesGetAll: () => ipcRenderer.invoke('notes:getAll'),
  notesCreate: (note) => ipcRenderer.invoke('notes:create', note),
  notesUpdate: (id, changes) => ipcRenderer.invoke('notes:update', id, changes),
  notesDelete: (id) => ipcRenderer.invoke('notes:delete', id),
  notesTogglePin: (id) => ipcRenderer.invoke('notes:togglePin', id),

  // Worksite（v1.7.0）
  worksitesList: () => ipcRenderer.invoke('worksites:list'),
  worksitesCreate: (payload) => ipcRenderer.invoke('worksites:create', payload),
  worksitesUpdate: (id, changes) => ipcRenderer.invoke('worksites:update', id, changes),
  worksitesDelete: (id) => ipcRenderer.invoke('worksites:delete', id),
  setItemsWorksite: (ids, worksiteId) => ipcRenderer.invoke('items:setWorksite', ids, worksiteId),

  // 配置导入导出
  configExport: () => ipcRenderer.invoke('config:export'),
  configImport: () => ipcRenderer.invoke('config:import'),

  // 钉图
  pinImage: (filePath) => ipcRenderer.send('pin:fromHistory', { filePath }),
  pinFromClipboard: () => ipcRenderer.send('pin:fromClipboard'),
  pinCloseAll: () => ipcRenderer.send('pin:closeAll'),

  // 宠物模式
  petMinimize: () => ipcRenderer.send('pet:minimize'),
  petExpand: () => ipcRenderer.send('pet:expand'),
  setPetSkin: (skin) => ipcRenderer.send('pet:setSkin', skin),
  setPetCustomColors: (c1, c2) => ipcRenderer.send('pet:setCustomColors', c1, c2),
  notifyPetFavorite: () => ipcRenderer.send('pet:notifyFavorite'),

  // 监听器注册（返回清理函数）
  onUpdate: (callback) => {
    const handler = (event, item) => callback(item)
    ipcRenderer.on('clipboard:update', handler)
    return () => ipcRenderer.removeListener('clipboard:update', handler)
  },
  onFocus: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('window:focus', handler)
    return () => ipcRenderer.removeListener('window:focus', handler)
  },
  onFocusSearch: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('window:focusSearch', handler)
    return () => ipcRenderer.removeListener('window:focusSearch', handler)
  }
})

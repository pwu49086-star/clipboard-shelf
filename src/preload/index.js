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

  // 开机自启
  setAutoStart: (enabled) => ipcRenderer.invoke('settings:setAutoStart', enabled),
  getAutoStart: () => ipcRenderer.invoke('settings:getAutoStart'),

  // 导入文件
  importImage: (base64, filename) => ipcRenderer.invoke('import:image', base64, filename),
  importText: (text) => ipcRenderer.invoke('import:text', text),

  // 设置最大记录数
  setMaxItems: (n) => ipcRenderer.invoke('settings:setMaxItems', n),

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

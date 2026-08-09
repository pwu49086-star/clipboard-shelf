import { useState, useEffect, useRef } from 'react'

export default function SettingsPanel({ onBack }) {
  const [autoStart, setAutoStart] = useState(false)
  const [maxItems, setMaxItems] = useState(2000)
  const maxItemsTimer = useRef(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('clipboard-shelf-settings')
      if (saved) {
        const s = JSON.parse(saved)
        if (s.autoStart !== undefined) setAutoStart(s.autoStart)
        if (s.maxItems !== undefined) setMaxItems(s.maxItems)
      }
    } catch {}
    try {
      if (window.api?.getAutoStart) window.api.getAutoStart().then(v => setAutoStart(v)).catch(() => {})
    } catch {}
  }, [])

  const handleAutoStart = (v) => {
    setAutoStart(v)
    try {
      const saved = localStorage.getItem('clipboard-shelf-settings')
      const settings = saved ? JSON.parse(saved) : {}
      settings.autoStart = v
      localStorage.setItem('clipboard-shelf-settings', JSON.stringify(settings))
    } catch {}
    try { window.api?.setAutoStart(v) } catch {}
  }

  const handleMaxItems = (v) => {
    const raw = v === '' ? '' : parseInt(v)
    if (raw === '') { setMaxItems(''); return }
    const n = Math.min(10000, Math.max(100, raw || 2000))
    setMaxItems(n)
    clearTimeout(maxItemsTimer.current)
    maxItemsTimer.current = setTimeout(() => {
      try {
        const saved = localStorage.getItem('clipboard-shelf-settings')
        const settings = saved ? JSON.parse(saved) : {}
        settings.maxItems = n
        localStorage.setItem('clipboard-shelf-settings', JSON.stringify(settings))
      } catch {}
      if (window.api?.setMaxItems) window.api.setMaxItems(n)
    }, 500)
  }

  const [exportStatus, setExportStatus] = useState('')
  const [importStatus, setImportStatus] = useState('')

  const handleExport = async () => {
    setExportStatus('导出中...')
    try {
      const result = await window.api.configExport()
      setExportStatus(result ? '已导出' : '已取消')
    } catch { setExportStatus('导出失败') }
    setTimeout(() => setExportStatus(''), 2000)
  }

  const handleImport = async () => {
    if (!window.confirm('导入将合并收藏和便签，配置将被覆盖。继续？')) return
    setImportStatus('导入中...')
    try {
      const result = await window.api.configImport()
      if (result?.error) setImportStatus('失败: ' + result.error)
      else setImportStatus("已导入 " + result.favCount + " 收藏, " + result.noteCount + " 便签")
    } catch { setImportStatus('导入失败') }
    setTimeout(() => setImportStatus(''), 3000)
  }

  return (
    <div className="app">
      <div className="settings-header">
        <button className="settings-back" onClick={onBack}>←</button>
        <span className="settings-title">设置</span>
      </div>
      <div className="settings-body">
        <div className="setting-group">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">开机自启</span>
              <span className="setting-desc">Windows 启动时自动运行</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={autoStart} onChange={e => handleAutoStart(e.target.checked)} />
              <span className="slider"></span>
            </label>
          </div>
        </div>

        <div className="setting-group">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">最大记录数</span>
              <span className="setting-desc">超出自动删除最旧的非收藏记录</span>
            </div>
            <input className="setting-input" type="number" value={maxItems} onChange={e => handleMaxItems(e.target.value)} min={100} max={10000} />
          </div>
        </div>

        <div className="setting-group">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">全局快捷键</span>
              <span className="setting-desc">呼出/隐藏窗口</span>
            </div>
            <span className="setting-value">Ctrl+Alt+Space</span>
          </div>
        </div>

        <div className="setting-group">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">数据备份</span>
              <span className="setting-desc">导出收藏和便签，或从备份恢复</span>
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="setting-btn" onClick={handleExport}>{exportStatus || '导出'}</button>
              <button className="setting-btn" onClick={handleImport}>{importStatus || '导入'}</button>
            </div>
          </div>
        </div>

        <div className="setting-group">
          <div className="setting-row"><div className="setting-label"><span className="setting-name">快捷操作</span></div></div>
          <div className="setting-shortcuts">
            <div className="shortcut-row"><kbd>↑↓</kbd> <span>选择记录</span></div>
            <div className="shortcut-row"><kbd>Enter</kbd> <span>复制选中</span></div>
            <div className="shortcut-row"><kbd>Delete</kbd> <span>删除选中</span></div>
            <div className="shortcut-row"><kbd>Ctrl+F</kbd> <span>聚焦搜索</span></div>
            <div className="shortcut-row"><kbd>Esc</kbd> <span>清空搜索</span></div>
            <div className="shortcut-row"><kbd>双击</kbd> <span>复制文字 / 编辑图片</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

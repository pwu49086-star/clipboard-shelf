import { useState, useEffect, useRef } from 'react'
import { BarChart3 } from 'lucide-react'

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

  const [hotkeys, setHotkeys] = useState({ toggle: 'Ctrl+Alt+Space', palette: 'Ctrl+Alt+K' })
  const [captureKey, setCaptureKey] = useState(null)
  const [hotkeyMsg, setHotkeyMsg] = useState('')
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('cs-theme') || 'light' } catch { return 'light' }
  })
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (window.api?.getHotkeys) window.api.getHotkeys().then(h => h && setHotkeys(h)).catch(() => {})
    if (window.api?.statsOverview) window.api.statsOverview().then(setStats).catch(() => {})
  }, [])

  const startCapture = (key) => { setCaptureKey(key); setHotkeyMsg('请按下新快捷键…') }

  const handleTheme = (v) => {
    setTheme(v)
    document.documentElement.dataset.theme = v
    try { localStorage.setItem('cs-theme', v) } catch {}
  }

  useEffect(() => {
    if (!captureKey) return
    const handleCapture = (e) => {
      e.preventDefault(); e.stopPropagation()
      const mods = []
      if (e.ctrlKey) mods.push('Ctrl')
      if (e.altKey) mods.push('Alt')
      if (e.shiftKey) mods.push('Shift')
      if (e.metaKey) mods.push('Super')
      const special = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab' }
      const key = e.key.length === 1 ? e.key.toUpperCase() : (special[e.key] || e.key)
      if (!mods.length || ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) { setHotkeyMsg('至少需要一个修饰键（Ctrl/Alt/Shift）'); return }
      const accel = [...mods, key].join('+')
      if (captureKey === 'palette' && accel === hotkeys.toggle) { setHotkeyMsg('不能与“呼出/隐藏窗口”相同'); return }
      if (captureKey === 'toggle' && accel === hotkeys.palette) { setHotkeyMsg('不能与“命令面板”相同'); return }
      setHotkeyMsg('保存中…')
      setCaptureKey(null)
      window.api.setHotkey(captureKey, accel).then(r => {
        if (r && r.error) { setHotkeyMsg(r.error); return }
        setHotkeys(h => ({ ...h, [captureKey]: accel }))
        setHotkeyMsg('已保存')
      })
    }
    window.addEventListener('keydown', handleCapture, true)
    return () => window.removeEventListener('keydown', handleCapture, true)
  }, [captureKey, hotkeys])

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
              <span className="setting-name">深色模式</span>
              <span className="setting-desc">切换浅色 / 深色主题</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={theme === 'dark'} onChange={e => handleTheme(e.target.checked ? 'dark' : 'light')} />
              <span className="slider"></span>
            </label>
          </div>
        </div>

        <div className="setting-group">
          <div className="setting-row"><div className="setting-label"><span className="setting-name"><BarChart3 size={14} style={{marginRight:6}} />数据统计</span></div></div>
          {stats ? (
            <div className="stats-grid">
              <div className="stat-item"><span className="stat-value">{stats.total}</span><span className="stat-label">总记录</span></div>
              <div className="stat-item"><span className="stat-value">{stats.favorites}</span><span className="stat-label">收藏</span></div>
              <div className="stat-item"><span className="stat-value">{stats.text}</span><span className="stat-label">文字</span></div>
              <div className="stat-item"><span className="stat-value">{stats.image}</span><span className="stat-label">图片</span></div>
              <div className="stat-item"><span className="stat-value">{stats.todayNew}</span><span className="stat-label">今日新增</span></div>
              <div className="stat-item"><span className="stat-value">{stats.notes}</span><span className="stat-label">便签</span></div>
              <div className="stat-item"><span className="stat-value">{stats.backups}</span><span className="stat-label">备份</span></div>
            </div>
          ) : <div className="setting-hint">加载中…</div>}
        </div>

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
              <span className="setting-name">呼出/隐藏窗口</span>
              <span className="setting-desc">全局快捷键</span>
            </div>
            <button className="hotkey-box" onClick={() => startCapture('toggle')}>
              {captureKey === 'toggle' ? '按下快捷键…' : hotkeys.toggle}
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">命令面板</span>
              <span className="setting-desc">全局快捷键</span>
            </div>
            <button className="hotkey-box" onClick={() => startCapture('palette')}>
              {captureKey === 'palette' ? '按下快捷键…' : hotkeys.palette}
            </button>
          </div>
          {hotkeyMsg && <div className="setting-hint">{hotkeyMsg}</div>}
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

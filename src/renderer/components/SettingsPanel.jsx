import { useState, useEffect, useRef } from 'react'
import { BarChart3, Info, Lock } from 'lucide-react'

export default function SettingsPanel({ onBack }) {
  const [autoStart, setAutoStart] = useState(false)
  const [retention, setRetention] = useState({ enabled: true, maxItems: 2000, maxDays: 0, maxImageItems: 0 })
  const [pasteOpts, setPasteOpts] = useState({ sequential: true })
  const retentionTimer = useRef(null)
  const [ignoreAppsText, setIgnoreAppsText] = useState('')
  const [metadataAppsText, setMetadataAppsText] = useState('')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('clipboard-shelf-settings')
      if (saved) {
        const s = JSON.parse(saved)
        if (s.autoStart !== undefined) setAutoStart(s.autoStart)
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
  const [enc, setEnc] = useState(null)
  const [capOpts, setCapOpts] = useState({ pause: false, skipSensitive: true })
  const [secMsg, setSecMsg] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [oldPw, setOldPw] = useState('')
  const [version, setVersion] = useState('')
  const [updateMsg, setUpdateMsg] = useState('')
  const [backups, setBackups] = useState([])
  const [backupSettings, setBackupSettings] = useState({ keepComplete: 3, log: [] })
  const [backupMsg, setBackupMsg] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [integrity, setIntegrity] = useState(null)
  const [dryRun, setDryRun] = useState(null)

  useEffect(() => {
    if (window.api?.getHotkeys) window.api.getHotkeys().then(h => h && setHotkeys(h)).catch(() => {})
    if (window.api?.statsOverview) window.api.statsOverview().then(setStats).catch(() => {})
    if (window.api?.encryptionGetStatus) window.api.encryptionGetStatus().then(setEnc).catch(() => {})
    if (window.api?.getCaptureOptions) window.api.getCaptureOptions().then(o => {
      setCapOpts(o)
      setIgnoreAppsText((o.ignoreApps || []).join(', '))
      setMetadataAppsText((o.metadataOnlyApps || []).join(', '))
    }).catch(() => {})
    if (window.api?.getRetention) window.api.getRetention().then(r => r && setRetention(r)).catch(() => {})
    if (window.api?.getPasteOptions) window.api.getPasteOptions().then(r => r && setPasteOpts(r)).catch(() => {})
    if (window.api?.getVersion) window.api.getVersion().then(setVersion).catch(() => {})
    if (window.api?.backupList) window.api.backupList().then(setBackups).catch(() => {})
    if (window.api?.backupGetSettings) window.api.backupGetSettings().then(setBackupSettings).catch(() => {})
  }, [])

  const fmtTime = (ts) => { try { return new Date(ts).toLocaleString() } catch { return String(ts) } }
  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB'
  const refreshBackups = async () => {
    if (window.api?.backupList) setBackups(await window.api.backupList())
    if (window.api?.backupGetSettings) setBackupSettings(await window.api.backupGetSettings())
  }
  const doCompleteBackup = async () => {
    setBackupBusy(true)
    setBackupMsg('')
    try {
      const r = await window.api.backupCreate()
      if (r && r.ok) setBackupMsg('完整备份成功')
      else setBackupMsg('备份失败：' + ((r && r.error) || '未知错误'))
    } catch (e) { setBackupMsg('备份失败：' + e.message) }
    finally { setBackupBusy(false); await refreshBackups() }
  }
  const doVerify = async (dir) => {
    const r = await window.api.backupVerify(dir)
    setBackupMsg(r && r.ok ? '验证通过' : '验证失败：' + ((r && r.errors || []).join('；') || '未知'))
  }
  const doRestore = async (dir) => {
    if (!window.confirm('恢复将关闭应用并替换全部数据（会自动创建当前环境回滚点）。确定继续？')) return
    setBackupMsg('正在恢复，应用即将重启…')
    const r = await window.api.backupRestore(dir)
    if (r && !r.ok) setBackupMsg('恢复失败：' + ((r && r.error) || '未知'))
  }
  const doIntegrity = async () => {
    const r = await window.api.integrityScan()
    setIntegrity(r)
  }
  const doDryRun = async () => {
    const r = await window.api.retentionDryRun()
    setDryRun(r)
  }
  const doSetKeep = async (v) => {
    const n = Math.max(1, Math.min(10, parseInt(v) || 3))
    const r = await window.api.backupSetSettings({ keepComplete: n })
    setBackupSettings(s => ({ ...s, keepComplete: (r && r.keepComplete) || n }))
  }

  const startCapture = (key) => { setCaptureKey(key); setHotkeyMsg('请按下新快捷键…') }

  const handleTheme = (v) => {
    setTheme(v)
    document.documentElement.dataset.theme = v
    try { localStorage.setItem('cs-theme', v) } catch {}
  }

  const refreshEnc = async () => {
    if (window.api?.encryptionGetStatus) setEnc(await window.api.encryptionGetStatus())
  }

  const doEnable = async () => {
    if (newPw.length < 4) { setSecMsg('密码至少 4 位'); return }
    if (newPw !== newPw2) { setSecMsg('两次输入的密码不一致'); return }
    const r = await window.api.encryptionEnable(newPw)
    if (r && r.ok) { setSecMsg('已启用加密，历史数据已加密'); setNewPw(''); setNewPw2(''); await refreshEnc() }
    else setSecMsg((r && r.error) || '启用失败')
  }

  const doDisable = async () => {
    const r = await window.api.encryptionDisable(oldPw)
    if (r && r.ok) { setSecMsg('已关闭加密，数据已解密'); setOldPw(''); await refreshEnc() }
    else setSecMsg((r && r.error) || '关闭失败')
  }

  const doLock = async () => {
    await window.api.encryptionLock()
    await refreshEnc()
  }

  const setCap = async (k, v) => {
    const n = { ...capOpts, [k]: v }
    setCapOpts(n)
    await window.api.setCaptureOptions(n)
  }

  const saveAppList = async (key, raw) => {
    const list = raw.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    await setCap(key, list)
  }

  const updateRetention = (patch) => {
    const next = { ...retention, ...patch }
    setRetention(next)
    clearTimeout(retentionTimer.current)
    retentionTimer.current = setTimeout(() => {
      if (window.api?.setRetention) window.api.setRetention(next)
    }, 500)
  }

  const setPasteOption = async (k, v) => {
    const next = { ...pasteOpts, [k]: v }
    setPasteOpts(next)
    await window.api.setPasteOptions(next)
  }

  const checkUpdate = async () => {
    setUpdateMsg('正在检查…')
    const r = await window.api.checkUpdate()
    if (!r || !r.ok) setUpdateMsg((r && r.error) || '检查失败')
    setTimeout(() => setUpdateMsg(''), 4000)
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
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">备份与恢复</span>
              <span className="setting-desc">完整备份 = DB 一致快照 + 配置 + 全部图片 + 校验清单</span>
            </div>
            <button className="hotkey-box" onClick={doCompleteBackup} disabled={backupBusy}>{backupBusy ? '备份中…' : '立即完整备份'}</button>
          </div>
          {backupMsg && <div className="setting-hint">{backupMsg}</div>}
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">保留完整备份数量</span>
              <span className="setting-desc">1–10，默认 3；新备份成功后才会清理旧备份</span>
            </div>
            <input className="setting-input" type="number" min={1} max={10} value={backupSettings.keepComplete} onChange={e => doSetKeep(e.target.value)} />
          </div>
          {(backups || []).length === 0 && <div className="setting-hint">暂无完整备份</div>}
          {(backups || []).map(b => (
            <div key={b.dir} className="setting-row">
              <div className="setting-label">
                <span className="setting-name">{fmtTime(b.createdAt)}</span>
                <span className="setting-desc">{fmtSize(b.size)} · {b.imageCount} 张图片 · {(b.counts && b.counts.items) || 0} 条记录</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="hotkey-box" onClick={() => doVerify(b.dir)}>验证</button>
                <button className="hotkey-box" onClick={() => doRestore(b.dir)}>恢复</button>
              </div>
            </div>
          ))}
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">资产一致性巡检（只读）</span>
              <span className="setting-desc">{integrity
                ? `图片行 ${integrity.summary.imageRows} · 缺失 ${integrity.summary.fullMissing} · 孤儿 ${integrity.summary.orphanFull}`
                : '检查 DB 与图片文件是否一致，只报告不修改'}</span>
            </div>
            <button className="hotkey-box" onClick={doIntegrity}>巡检</button>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">清理试运行（dry-run）</span>
              <span className="setting-desc">{dryRun
                ? `将删除 ${dryRun.itemCount} 条（图片 ${dryRun.imageCount}，标注 ${dryRun.annotationCount}）· 释放 ${fmtSize(dryRun.bytesFreed)}`
                : '预览 retention 将清理的内容，不执行删除'}</span>
            </div>
            <button className="hotkey-box" onClick={doDryRun}>试运行</button>
          </div>
          {backupSettings.log && backupSettings.log.filter(l => !l.ok).length > 0 && (
            <div className="setting-hint">最近失败：{backupSettings.log.filter(l => !l.ok).pop().error}</div>
          )}
        </div>

        <div className="setting-group">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name"><Lock size={14} style={{marginRight:6}} />主密码加密</span>
              <span className="setting-desc">
                {enc ? (enc.enabled ? (enc.unlocked ? '已加密 · 已解锁' : '已加密 · 已锁定') : '未启用') : '加载中…'}
              </span>
            </div>
          </div>
          {enc && !enc.enabled && (
            <div className="security-fields">
              <input className="setting-input" type="password" placeholder="新密码（至少 4 位）" value={newPw} onChange={e => setNewPw(e.target.value)} />
              <input className="setting-input" type="password" placeholder="确认密码" value={newPw2} onChange={e => setNewPw2(e.target.value)} />
              <button className="setting-btn" onClick={doEnable}>启用加密</button>
            </div>
          )}
          {enc && enc.enabled && enc.unlocked && (
            <div className="security-fields">
              <button className="setting-btn" onClick={doLock}>立即锁定</button>
              <input className="setting-input" type="password" placeholder="当前密码（关闭加密用）" value={oldPw} onChange={e => setOldPw(e.target.value)} />
              <button className="setting-btn danger" onClick={doDisable}>关闭加密</button>
            </div>
          )}
          {secMsg && <div className="setting-hint">{secMsg}</div>}
          <div className="setting-hint">密码只保存在你脑中，忘记后数据无法恢复。</div>
        </div>

        <div className="setting-group">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">暂停剪贴板监听</span>
              <span className="setting-desc">暂停期间复制的内容不会被记录</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={capOpts.pause} onChange={e => setCap('pause', e.target.checked)} />
              <span className="slider"></span>
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">敏感内容保护</span>
              <span className="setting-desc">🟡 敏感保存但预览打码；🔴 高敏感只存元数据</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={capOpts.skipSensitive} onChange={e => setCap('skipSensitive', e.target.checked)} />
              <span className="slider"></span>
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">忽略来源应用</span>
              <span className="setting-desc">这些应用复制的内容完全不记录（逗号分隔）</span>
            </div>
          </div>
          <input
            className="setting-input"
            type="text"
            placeholder="如：PasswordManager, KeePass"
            value={ignoreAppsText}
            onChange={e => setIgnoreAppsText(e.target.value)}
            onBlur={e => saveAppList('ignoreApps', e.target.value)}
          />
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">仅保存元数据应用</span>
              <span className="setting-desc">只记录来源和时间，不保存内容（逗号分隔）</span>
            </div>
          </div>
          <input
            className="setting-input"
            type="text"
            placeholder="如：WeChat, DingTalk"
            value={metadataAppsText}
            onChange={e => setMetadataAppsText(e.target.value)}
            onBlur={e => saveAppList('metadataOnlyApps', e.target.value)}
          />
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
          <div className="setting-row"><div className="setting-label"><span className="setting-name"><Info size={14} style={{marginRight:6}} />关于</span></div></div>
          <div className="about-block">
            <div className="about-line">Clipboard Shelf <span className="about-version">v{version || '…'}</span></div>
            <a className="about-link" href="https://github.com/pwu49086-star/clipboard-shelf" target="_blank" rel="noreferrer">GitHub 仓库</a>
            <button className="setting-btn" onClick={checkUpdate}>{updateMsg || '检查更新'}</button>
          </div>
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
              <span className="setting-name">自动清理</span>
              <span className="setting-desc">收藏内容永不自动删除</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={retention.enabled} onChange={e => updateRetention({ enabled: e.target.checked })} />
              <span className="slider"></span>
            </label>
          </div>
          {retention.enabled && (
            <>
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name">最大记录数</span>
                  <span className="setting-desc">超出后删除最旧的未收藏记录（0 = 不限制）</span>
                </div>
                <input className="setting-input" type="number" value={retention.maxItems} onChange={e => updateRetention({ maxItems: parseInt(e.target.value) || 0 })} min={0} max={100000} />
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name">按天数清理</span>
                  <span className="setting-desc">超过天数自动删除未收藏记录（0 = 关闭）</span>
                </div>
                <input className="setting-input" type="number" value={retention.maxDays} onChange={e => updateRetention({ maxDays: parseInt(e.target.value) || 0 })} min={0} max={3650} />
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name">图片独立上限</span>
                  <span className="setting-desc">未收藏图片超过数量自动清理（0 = 不限制）</span>
                </div>
                <input className="setting-input" type="number" value={retention.maxImageItems} onChange={e => updateRetention({ maxImageItems: parseInt(e.target.value) || 0 })} min={0} max={100000} />
              </div>
            </>
          )}
        </div>

        <div className="setting-group">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">顺序粘贴</span>
              <span className="setting-desc">Enter 复制后自动选中下一条，可连续粘贴</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={pasteOpts.sequential} onChange={e => setPasteOption('sequential', e.target.checked)} />
              <span className="slider"></span>
            </label>
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
            <div className="shortcut-row"><kbd>1-9</kbd> <span>按序号选择记录</span></div>
            <div className="shortcut-row"><kbd>Enter</kbd> <span>复制选中并下移</span></div>
            <div className="shortcut-row"><kbd>Ctrl+Shift+V</kbd> <span>复制为纯文本（再按 Ctrl+V 粘贴）</span></div>
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

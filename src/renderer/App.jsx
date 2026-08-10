import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Moon, Code, Link, Flame, TrendingUp, Smile, Clipboard, Star, FileText, Image } from 'lucide-react'
import SearchBar from './components/SearchBar'
import ItemList from './components/ItemList'
import SettingsPanel from './components/SettingsPanel'
import PetSettings from './components/PetSettings'
import NotesPanel from './components/NotesPanel'
import CommandPalette from './components/CommandPalette'
import pasteUtils from '../shared/paste-utils.cjs'

const { numberedIndex, nextIndex, plainTextPayload } = pasteUtils

const ICONS = { Moon, Code, Link, Flame, TrendingUp, Smile }

export default function App() {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem('cs-pinned') === 'true' } catch { return false }
  })
  const [shooting, setShooting] = useState(false)
  const [panel, setPanel] = useState('main')
  const [filter, setFilter] = useState('all')
  const [editModal, setEditModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [previewItem, setPreviewItem] = useState(null)
  const [petFeedback, setPetFeedback] = useState(null)
  const [multiMode, setMultiMode] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [pasteOpts, setPasteOpts] = useState({ sequential: true })
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('cs-theme') || 'light' } catch { return 'light' }
  })
  const [encStatus, setEncStatus] = useState({ enabled: false, unlocked: true })
  const [lockPw, setLockPw] = useState('')
  const [lockMsg, setLockMsg] = useState('')
  const toastTimer = useRef(null)
  const searchRef = useRef(null)
  const debounceRef = useRef(null)
  const deleteConfirmTimer = useRef(null)
  const lastSelectedId = useRef(null)
  const shiftKeyRef = useRef(false)
  const searchRef2 = useRef(search)
  searchRef2.current = search
  const filterRef2 = useRef(filter)
  filterRef2.current = filter
  const handleCopyRef = useRef(null)
  const handleDeleteRef = useRef(null)

  useEffect(() => { if (pinned) window.api.setAlwaysOnTop(true) }, [])

  // 粘贴选项（顺序粘贴开关；从设置页返回时刷新）
  useEffect(() => {
    if (panel === 'main' && window.api?.getPasteOptions) {
      window.api.getPasteOptions().then(r => r && setPasteOpts(r)).catch(() => {})
    }
  }, [panel])

  // 加密状态
  useEffect(() => {
    if (window.api?.encryptionGetStatus) {
      window.api.encryptionGetStatus().then(setEncStatus).catch(() => {})
    }
  }, [])

  // 命令面板（全局快捷键触发）
  useEffect(() => {
    const off = window.api.onPaletteToggle ? window.api.onPaletteToggle(() => setPaletteOpen(o => !o)) : null
    return () => { if (off) off() }
  }, [])

  // 主题
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('cs-theme', theme) } catch {}
  }, [theme])

  // 追踪 Shift 键状态
  useEffect(() => {
    const down = (e) => { if (e.key === 'Shift') shiftKeyRef.current = true }
    const up = (e) => { if (e.key === 'Shift') shiftKeyRef.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const showToast = useCallback((msg) => {
    clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }, [])

  const loadItems = useCallback(async (query = '', filter = 'all') => {
    try {
      const opts = { search: query, limit: 5000 }
      if (filter === 'fav') opts.favorite = true
      else if (filter === 'text' || filter === 'image') opts.type = filter
      const data = await window.api.getAll(opts)
      setItems(data)
    } catch (e) { console.error('Load failed:', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (encStatus.enabled && !encStatus.unlocked) return
    loadItems()
  }, [encStatus, loadItems])

  useEffect(() => {
    const load = async () => {
      try { setPetFeedback(await window.api.memoryPetFeedback()) } catch {}
    }
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (filter !== 'notes' && !(encStatus.enabled && !encStatus.unlocked)) loadItems(search, filter)
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [search, loadItems, filter, encStatus])

  useEffect(() => {
    const offUpdate = window.api.onUpdate((item) => {
      if (item._deleted) {
        setItems(prev => prev.filter(i => i.id !== item.id))
        setSelectedIds(prev => { const n = new Set(prev); n.delete(item.id); return n })
      } else if (item._ocrUpdated) {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, ocrText: item.ocrText } : i))
      } else if (item.id) {
        setItems(prev => {
          const exists = prev.findIndex(i => i.id === item.id)
          if (exists >= 0) { const next = [...prev]; next[exists] = item; return next }
          // 新项目插入后重新排序：收藏优先，然后按时间
          const next = [item, ...prev].slice(0, 200)
          next.sort((a, b) => {
            if (a.isFavorite !== b.isFavorite) return b.isFavorite - a.isFavorite
            return b.createTime - a.createTime
          })
          return next
        })
      } else {
        loadItems(searchRef2.current, filterRef2.current)
      }
      window.api.memoryPetFeedback().then(setPetFeedback).catch(() => {})
    })
    const offFocus = window.api.onFocus(() => { searchRef.current?.focus(); searchRef.current?.select() })
    const offFocusSearch = window.api.onFocusSearch(() => { searchRef.current?.focus(); searchRef.current?.select() })
    return () => { offUpdate(); offFocus(); offFocusSearch() }
  }, [])

  const handleCopy = useCallback(async (item) => {
    try {
      await window.api.copyItem(item)
      showToast(item.type === 'image' ? '图片已复制' : '文字已复制')
    } catch (e) { console.error('Copy failed:', e) }
  }, [showToast])
  handleCopyRef.current = handleCopy

  const handleEdit = useCallback(async (item) => {
    if (item.type === 'image' && item.filePath) {
      setPreviewItem(item)
    } else {
      try { if (item.filePath) await window.api.openInEditor(item.filePath) } catch {}
    }
  }, [])

  const handleDelete = useCallback(async (id) => {
    try {
      await window.api.deleteItem(id)
      setItems(prev => prev.filter(i => i.id !== id))
      setSelectedId(prev => prev === id ? null : prev)
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
    } catch (e) { console.error('Delete failed:', e) }
  }, [])
  handleDeleteRef.current = handleDelete

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    if (!window.confirm(`确定删除选中的 ${selectedIds.size} 条记录？`)) return
    try {
      const ids = [...selectedIds]
      await window.api.batchDeleteItems(ids)
      setItems(prev => prev.filter(i => !selectedIds.has(i.id)))
      setSelectedIds(new Set())
      setSelectedId(null)
      showToast(`已删除 ${ids.length} 条记录`)
    } catch (e) { console.error('Batch delete failed:', e) }
  }, [selectedIds, showToast])

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'fav') return items.filter(i => i.isFavorite === 1)
    return items.filter(i => i.type === filter)
  }, [items, filter])
  const filteredItemsRef = useRef(filteredItems)
  filteredItemsRef.current = filteredItems

  const handleSelect = useCallback((id) => {
    if (multiMode) {
      // 多选模式：点击切换选中/取消
      setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    } else {
      // 普通模式：单选
      setSelectedIds(new Set([id]))
      setSelectedId(id)
    }
  }, [multiMode])

  const handleToggleFavorite = useCallback(async (id) => {
    try {
      const updated = await window.api.toggleFavorite(id)
      if (updated) {
        if (updated.isFavorite && window.api.notifyPetFavorite) window.api.notifyPetFavorite()
        setItems(prev => {
          const next = prev.map(i => i.id === id ? updated : i)
          next.sort((a, b) => {
            if (a.isFavorite !== b.isFavorite) return b.isFavorite - a.isFavorite
            return b.createTime - a.createTime
          })
          return next
        })
      }
    } catch (e) { console.error('Toggle favorite failed:', e) }
  }, [])

  const handleEditContent = useCallback((id, content) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, content } : i))
  }, [])

  const openEditModal = useCallback((item) => { setEditModal({ id: item.id, content: item.content || '' }) }, [])

  const saveEditModal = useCallback(() => {
    if (editModal) {
      window.api.editItem(editModal.id, editModal.content)
      setItems(prev => prev.map(i => i.id === editModal.id ? { ...i, content: editModal.content } : i))
      setEditModal(null)
    }
  }, [editModal])

  const handleScreenshot = useCallback(async () => {
    setShooting(true)
    try { await window.api.screenshot() } catch {}
    finally { setShooting(false) }
  }, [])

  const doUnlock = useCallback(async () => {
    try {
      const r = await window.api.encryptionUnlock(lockPw)
      if (r && r.ok) {
        setEncStatus({ enabled: true, unlocked: true })
        setLockPw('')
        setLockMsg('')
        loadItems(searchRef2.current, filterRef2.current)
      } else {
        setLockMsg((r && r.error) || '解锁失败')
      }
    } catch (e) {
      setLockMsg('解锁失败')
    }
  }, [lockPw, loadItems])

  // 托盘命令
  useEffect(() => {
    const off = window.api.onTrayCommand ? window.api.onTrayCommand((action) => {
      if (action === 'palette') setPaletteOpen(true)
      else if (action === 'screenshot') handleScreenshot()
    }) : null
    return () => { if (off) off() }
  }, [handleScreenshot])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.type.startsWith('image/')) {
        try {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result.split(',')[1])
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          await window.api.importImage(base64, file.name)
        } catch {}
      } else if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        try { await window.api.importText(await file.text()) } catch {}
      }
    }
    loadItems(search)
  }, [search, loadItems])

  const handleBack = useCallback(() => setPanel('main'), [])
  
  const closePreview = useCallback(() => setPreviewItem(null), [])
  const openPreviewEditor = useCallback(async () => {
    if (previewItem?.filePath) {
      try { await window.api.openInEditor(previewItem.filePath) } catch {}
    }
    setPreviewItem(null)
  }, [previewItem])

  // 键盘导航
  useEffect(() => {
    const handler = (e) => {
      if (panel !== 'main') return
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) { setSelectedIds(new Set()); setSelectedId(null) }
        else if (search) setSearch('')
        return
      }
      if (e.ctrlKey && e.key === 'f') { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.ctrlKey && e.key === 'a' && filter !== 'notes') {
        e.preventDefault()
        setSelectedIds(new Set(filteredItems.map(i => i.id)))
        setMultiMode(true)
        return
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault()
        const item = filteredItems.find(i => i.id === selectedId)
        const payload = plainTextPayload(item)
        if (!payload) {
          showToast(item ? '仅文字支持纯文本粘贴' : '先选择一条文字记录')
          return
        }
        window.api.copyPlainText(payload)
        showToast('已复制纯文本，按 Ctrl+V 粘贴')
        return
      }
      if (!filteredItems.length || filter === 'notes') return
      const idx = filteredItems.findIndex(i => i.id === selectedId)
      const numIdx = !multiMode && !e.ctrlKey && !e.altKey && !e.metaKey
        ? numberedIndex(e.key, filteredItems.length)
        : null
      if (numIdx !== null) { e.preventDefault(); const id = filteredItems[numIdx].id; setSelectedIds(new Set([id])); setSelectedId(id); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedId(filteredItems[(idx + 1) % filteredItems.length].id) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedId(filteredItems[idx > 0 ? idx - 1 : filteredItems.length - 1].id) }
      else if (e.key === 'Enter' && selectedId !== null) {
        e.preventDefault()
        const item = filteredItems.find(i => i.id === selectedId)
        if (item) {
          handleCopyRef.current(item)
          if (pasteOpts.sequential) {
            const next = nextIndex(idx, filteredItems.length)
            if (next !== null) {
              const nextId = filteredItems[next].id
              setSelectedIds(new Set([nextId]))
              setSelectedId(nextId)
            }
          }
        }
      }
      else if (e.key === 'Delete' && selectedId !== null) {
        e.preventDefault()
        if (deleteConfirmId === selectedId) {
          clearTimeout(deleteConfirmTimer.current)
          setDeleteConfirmId(null)
          handleDeleteRef.current(selectedId)
        } else {
          setDeleteConfirmId(selectedId)
          showToast('再按一次 Delete 确认删除')
          deleteConfirmTimer.current = setTimeout(() => setDeleteConfirmId(null), 2000)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [items, selectedId, search, panel, deleteConfirmId, filter, selectedIds, filteredItems, showToast, pasteOpts])

  return (
    <div className="app" onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
      <div className="title-bar" />

      {panel === 'settings' && <SettingsPanel onBack={handleBack} />}
      {panel === 'pet' && <PetSettings onBack={handleBack} />}

      {panel === 'main' && (
        <>
          {petFeedback && (() => {
            const Icon = ICONS[petFeedback.icon] || Smile
            return (
              <div className="pet-feedback-bar">
                <Icon size={18} strokeWidth={1.75} style={{color:'var(--color-primary)',flexShrink:0}} />
                <div>
                  <div className="pet-feedback-text">{petFeedback.text}</div>
                  <div className="pet-feedback-sub">{filteredItems.length} 条记录</div>
                </div>
              </div>
            )
          })()}

          <SearchBar ref={searchRef} value={search} onChange={setSearch} count={filter === 'notes' ? 0 : filteredItems.length} />
          <div className="filter-bar">
            <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => { setFilter('all'); setSelectedIds(new Set()) }}>全部</button>
            <button className={`filter-btn ${filter === 'text' ? 'active' : ''}`} onClick={() => { setFilter('text'); setSelectedIds(new Set()) }}>文字</button>
            <button className={`filter-btn ${filter === 'image' ? 'active' : ''}`} onClick={() => { setFilter('image'); setSelectedIds(new Set()) }}>图片</button>
            <button className={`filter-btn ${filter === 'fav' ? 'active' : ''}`} onClick={() => { setFilter('fav'); setSelectedIds(new Set()) }}>收藏</button>
            <button className={`filter-btn ${filter === 'notes' ? 'active' : ''}`} onClick={() => { setFilter('notes'); setSelectedIds(new Set()) }}>便签</button>
          </div>

          {filter === 'notes' ? (
            <NotesPanel embedded searchQuery={search} />
          ) : (
            <ItemList
              items={filteredItems} selectedId={selectedId} selectedIds={selectedIds} multiMode={multiMode}
              emptyHint={filter === 'fav' ? '还没有收藏内容' : filter === 'image' ? '还没有图片' : filter === 'text' ? '还没有文字' : '剪贴板为空'}
              onSelect={handleSelect}
              onCopy={handleCopy} onDelete={handleDelete} onToggleFavorite={handleToggleFavorite}
              onEdit={handleEdit} onEditContent={handleEditContent} onOpenEdit={openEditModal} loading={loading} searchQuery={search}
            />
          )}

          {multiMode && (
            <div className="batch-bar">
              <span className="batch-count">已选 {selectedIds.size} 条</span>
              <button className="batch-btn" onClick={() => { setSelectedIds(new Set()); setMultiMode(false) }}>取消</button>
              <button className="batch-btn" onClick={() => setSelectedIds(new Set(filteredItems.map(i => i.id)))}>全选</button>
              <button className="batch-btn batch-btn-danger" onClick={handleBatchDelete} disabled={selectedIds.size === 0}>删除选中</button>
            </div>
          )}

          <div className="status-bar">
            <button className="status-btn" onClick={() => window.api.petMinimize()} title="收起为小宠物">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
            </button>
            <span className="status-count">
              {filter === 'notes' ? (
                <><FileText size={12} style={{marginRight:3,verticalAlign:'middle'}} />便签</>
              ) : (
                <>
                  <Clipboard size={12} style={{marginRight:3,verticalAlign:'middle'}} />{items.length}
                  {items.filter(i=>i.isFavorite===1).length > 0 && <> <Star size={12} style={{marginRight:2,verticalAlign:'middle'}} />{items.filter(i=>i.isFavorite===1).length}</>}
                  {items.filter(i=>i.type==='text').length > 0 && <> <FileText size={12} style={{marginRight:2,verticalAlign:'middle'}} />{items.filter(i=>i.type==='text').length}</>}
                  {items.filter(i=>i.type==='image').length > 0 && <> <Image size={12} style={{marginRight:2,verticalAlign:'middle'}} />{items.filter(i=>i.type==='image').length}</>}
                </>
              )}
            </span>
            <div className="status-actions">
              <button className="status-btn" onClick={handleScreenshot} title="截图" disabled={shooting}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </button>
              <button className={`status-btn ${multiMode ? 'active' : ''}`} onClick={() => { setMultiMode(!multiMode); setSelectedIds(new Set()) }} title={multiMode ? '退出多选' : '多选'}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
              </button>
              <button className={`status-btn ${pinned ? 'active' : ''}`} onClick={() => { const n = !pinned; setPinned(n); window.api.setAlwaysOnTop(n); try { localStorage.setItem('cs-pinned', String(n)) } catch {} }} title={pinned ? '取消固定' : '固定窗口'}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 17v5M9 11l-5 5 5 5h6l5-5-5-5"/><path d="M12 2v7"/></svg>
              </button>
              <button className="status-btn" onClick={() => setPanel('pet')} title="宠物设置">🐾</button>
              <button className="status-btn" onClick={() => setPaletteOpen(true)} title="命令面板 (Ctrl+Alt+K)">⌘</button>
              <button className="status-btn" onClick={() => setPanel('settings')} title="设置">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
              </button>
            </div>
          </div>
        </>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {toast && <div className="toast">{toast}</div>}

      {encStatus.enabled && !encStatus.unlocked && (
        <div className="lock-overlay">
          <div className="lock-card">
            <div className="lock-title">🔒 剪贴板已锁定</div>
            <div className="lock-desc">输入主密码解锁历史记录</div>
            <input
              type="password"
              className="lock-input"
              value={lockPw}
              onChange={e => setLockPw(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') doUnlock() }}
              autoFocus
              placeholder="主密码"
            />
            {lockMsg && <div className="lock-msg">{lockMsg}</div>}
            <button className="lock-btn" onClick={doUnlock}>解锁</button>
            <div className="lock-hint">忘记密码将无法恢复数据</div>
          </div>
        </div>
      )}

      {previewItem && (
        <div className="preview-overlay" onClick={closePreview}>
          <div className="preview-actions">
            <button className="preview-btn" onClick={(e) => { e.stopPropagation(); openPreviewEditor() }}>编辑</button>
            <button className="preview-btn" onClick={(e) => { e.stopPropagation(); closePreview() }}>关闭</button>
          </div>
          <img
            className="preview-img"
            src={'shelf-file://full/' + previewItem.filePath.replace(/\\/g, '/').split('/').pop()}
            onClick={(e) => e.stopPropagation()}
            onError={(e) => { e.target.src = 'shelf-file://thumb/' + previewItem.thumbPath?.replace(/\\/g, '/').split('/').pop() }}
          />
        </div>
      )}

      {editModal && (
        <div className="modal-overlay" onClick={() => { if(window.confirm('未保存的更改将丢失，确定关闭？')) setEditModal(null) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">编辑文字</span>
              <button className="modal-close" onClick={() => setEditModal(null)}>×</button>
            </div>
            <textarea
              className="modal-textarea"
              value={editModal.content}
              onChange={e => setEditModal({ ...editModal, content: e.target.value })}
              onKeyDown={e => { if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveEditModal() } }}
              placeholder="输入文字…"
              autoFocus
            />
            <div className="modal-footer">
              <span className="modal-char-count">{editModal.content.length} 字</span>
              <div className="modal-actions">
                <button className="btn btn-cancel" onClick={() => setEditModal(null)}>取消</button>
                <button className="btn btn-save" onClick={saveEditModal}>保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

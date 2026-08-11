import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Moon, Code, Link, Flame, TrendingUp, Smile, Clipboard, Star, FileText, Image } from 'lucide-react'
import SearchBar from './components/SearchBar'
import ItemList from './components/ItemList'
import SettingsPanel from './components/SettingsPanel'
import PetSettings from './components/PetSettings'
import NotesPanel from './components/NotesPanel'
import WorksitesPanel from './components/WorksitesPanel'
import WorksitePicker from './components/WorksitePicker'
import CommandPalette from './components/CommandPalette'
import pasteUtils from '../shared/paste-utils.cjs'
import itemsMerge from '../shared/items-merge.cjs'
import queryUtils from '../shared/entity-query.cjs'
import outputUtils from '../shared/collection-output.cjs'

const { numberedIndex, nextIndex, plainTextPayload } = pasteUtils
const { mergeItemIntoList } = itemsMerge
const { parseEntityQuery, filterToSearchText, stripFilterToken } = queryUtils
const { buildPlainText, buildMarkdown, buildWorkOrderDraft } = outputUtils

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
  const [activeWorksite, setActiveWorksite] = useState(null)
  const [worksitePickerOpen, setWorksitePickerOpen] = useState(false)
  const [editModal, setEditModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [previewItem, setPreviewItem] = useState(null)
  const [draftModal, setDraftModal] = useState(null)
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
  const activeWorksiteRef = useRef(activeWorksite)
  activeWorksiteRef.current = activeWorksite
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
      const parsed = parseEntityQuery(query)
      const opts = {
        search: parsed.plain.join(' '),
        limit: 5000,
        entityFilters: parsed.entityFilters,
        withEntities: true
      }
      const isModelHistory = parsed.entityFilters.length === 1 && parsed.entityFilters[0].type === 'model'
      if (isModelHistory) opts.sort = 'time'
      if (filter === 'fav') opts.favorite = true
      else if (filter === 'text' || filter === 'image') opts.type = filter
      if (activeWorksite && filter === 'worksites') {
        opts.worksiteId = activeWorksite.id
        opts.sort = 'time'
      }
      const data = await window.api.getAll(opts)
      setItems(data)
    } catch (e) { console.error('Load failed:', e) }
    finally { setLoading(false) }
  }, [activeWorksite])

  useEffect(() => {
    if (encStatus.enabled && !encStatus.unlocked) return
    loadItems(searchRef2.current, filterRef2.current)
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
      if (filter === 'notes') return
      if (filter === 'worksites' && !activeWorksite) return
      if (encStatus.enabled && !encStatus.unlocked) return
      loadItems(search, filter)
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [search, loadItems, filter, encStatus, activeWorksite])

  useEffect(() => {
    const offUpdate = window.api.onUpdate((item) => {
      if (item._deleted) {
        setItems(prev => prev.filter(i => i.id !== item.id))
        setSelectedIds(prev => { const n = new Set(prev); n.delete(item.id); return n })
      } else if (item._ocrUpdated) {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, ocrText: item.ocrText } : i))
      } else if (item.id) {
        setItems(prev => {
          const ws = activeWorksiteRef.current
          if (ws && filterRef2.current === 'worksites' && item.worksiteId !== ws.id) return prev
          return mergeItemIntoList(prev, item)
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

  const handleEntityClick = useCallback((type, value) => {
    setSearch(filterToSearchText({ type, value }))
  }, [])

  const handleRemoveEntityFilter = useCallback((filter) => {
    setSearch(prev => stripFilterToken(prev, filter))
  }, [])

  const fetchSelectedItems = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return { items: [], skipped: 0 }
    const rows = await window.api.getAll({ ids, limit: Math.max(ids.length, 1), withEntities: true })
    const map = new Map(rows.map(i => [i.id, i]))
    const items = []
    let skipped = 0
    for (const id of ids) {
      const it = map.get(id)
      if (it) items.push(it)
      else skipped++
    }
    return { items, skipped }
  }, [selectedIds])

  const handleCopyAll = useCallback(async () => {
    if (!selectedIds.size) { showToast('请先选择记录'); return }
    const { items, skipped } = await fetchSelectedItems()
    const out = buildPlainText(items)
    if (!out.count) { showToast('没有可输出的记录'); return }
    await window.api.copyPlainText({ type: 'text', content: out.text })
    showToast(`已复制 ${out.count} 条记录${skipped ? `，${skipped} 条已不存在` : ''}`)
  }, [selectedIds, fetchSelectedItems, showToast])

  const handleCopyMarkdown = useCallback(async () => {
    if (!selectedIds.size) { showToast('请先选择记录'); return }
    const { items, skipped } = await fetchSelectedItems()
    const out = buildMarkdown(items)
    if (!out.count) { showToast('没有可输出的记录'); return }
    await window.api.copyPlainText({ type: 'text', content: out.text })
    showToast(`Markdown 已复制（${out.count} 条${skipped ? `，${skipped} 条已不存在` : ''}）`)
  }, [selectedIds, fetchSelectedItems, showToast])

  const exportMarkdownContent = useCallback(async (content) => {
    const r = await window.api.exportMarkdown({
      content,
      defaultName: `维修记录-${new Date().toISOString().slice(0, 10)}.md`
    })
    if (!r) return
    if (r.canceled) { showToast('已取消导出'); return }
    if (r.ok) showToast('已导出 Markdown')
    else showToast('导出失败：' + (r.error || '未知错误'))
  }, [showToast])

  const handleExportMarkdown = useCallback(async () => {
    if (!selectedIds.size) { showToast('请先选择记录'); return }
    const { items, skipped } = await fetchSelectedItems()
    const out = buildMarkdown(items)
    if (!out.count) { showToast('没有可输出的记录'); return }
    await exportMarkdownContent(out.text)
    if (skipped) showToast(`已导出 ${out.count} 条，${skipped} 条已不存在`)
  }, [selectedIds, fetchSelectedItems, exportMarkdownContent, showToast])

  const handleWorkOrderDraft = useCallback(async () => {
    if (!selectedIds.size) { showToast('请先选择记录'); return }
    const { items, skipped } = await fetchSelectedItems()
    const out = buildWorkOrderDraft(items)
    if (!out.count) { showToast('没有可输出的记录'); return }
    setDraftModal({ content: out.text, skipped })
  }, [selectedIds, fetchSelectedItems])

  const handleOpenWorksite = useCallback((ws) => {
    setActiveWorksite(ws)
    setFilter('worksites')
    setSelectedIds(new Set())
    setMultiMode(false)
  }, [])

  const refreshActiveWorksite = useCallback(async () => {
    const ws = activeWorksiteRef.current
    if (!ws) return
    try {
      const fresh = (await window.api.worksitesList()).find(w => w.id === ws.id)
      if (fresh) setActiveWorksite(fresh)
    } catch {}
  }, [])

  const handleJoinWorksite = useCallback(async (ws) => {
    if (!selectedIds.size) { showToast('请先选择记录'); return }
    const r = await window.api.setItemsWorksite([...selectedIds], ws.id)
    if (!r || !r.ok) { showToast((r && r.error) || '加入失败'); return }
    setSelectedIds(new Set())
    setWorksitePickerOpen(false)
    showToast(`已加入现场「${ws.title}」（${r.updated} 条）`)
    refreshActiveWorksite()
  }, [selectedIds, showToast, refreshActiveWorksite])

  const handleQuickCreateWorksite = useCallback(async (title, note) => {
    const ws = await window.api.worksitesCreate({ title, note })
    if (!ws) return { ok: false, error: '现场名称不能为空' }
    const r = await window.api.setItemsWorksite([...selectedIds], ws.id)
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || '加入失败' }
    setSelectedIds(new Set())
    showToast(`已创建并加入现场「${ws.title}」（${r.updated} 条）`)
    refreshActiveWorksite()
    return { ok: true }
  }, [selectedIds, showToast, refreshActiveWorksite])

  const handleRemoveFromWorksite = useCallback(async () => {
    const ws = activeWorksiteRef.current
    if (!ws || !selectedIds.size) { showToast('请先选择记录'); return }
    const r = await window.api.setItemsWorksite([...selectedIds], null)
    if (!r || !r.ok) { showToast((r && r.error) || '移出失败'); return }
    setSelectedIds(new Set())
    showToast(`已移出现场（${r.updated} 条）`)
    loadItems(searchRef2.current, 'worksites')
    refreshActiveWorksite()
  }, [selectedIds, loadItems, showToast, refreshActiveWorksite])

  const parsedQuery = useMemo(() => parseEntityQuery(search), [search])

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'fav') return items.filter(i => i.isFavorite === 1)
    if (filter === 'notes' || filter === 'worksites') return items
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

          <SearchBar
            ref={searchRef}
            value={search}
            onChange={setSearch}
            count={filter === 'notes' ? 0 : filteredItems.length}
            entityFilters={parsedQuery.entityFilters}
            onRemoveFilter={handleRemoveEntityFilter}
          />
          {!(filter === 'worksites' && activeWorksite) && (
            <div className="filter-bar">
              <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => { setFilter('all'); setSelectedIds(new Set()) }}>全部</button>
              <button className={`filter-btn ${filter === 'text' ? 'active' : ''}`} onClick={() => { setFilter('text'); setSelectedIds(new Set()) }}>文字</button>
              <button className={`filter-btn ${filter === 'image' ? 'active' : ''}`} onClick={() => { setFilter('image'); setSelectedIds(new Set()) }}>图片</button>
              <button className={`filter-btn ${filter === 'fav' ? 'active' : ''}`} onClick={() => { setFilter('fav'); setSelectedIds(new Set()) }}>收藏</button>
              <button className={`filter-btn ${filter === 'worksites' ? 'active' : ''}`} onClick={() => { setFilter('worksites'); setActiveWorksite(null); setSelectedIds(new Set()) }}>现场</button>
              <button className={`filter-btn ${filter === 'notes' ? 'active' : ''}`} onClick={() => { setFilter('notes'); setSelectedIds(new Set()) }}>便签</button>
            </div>
          )}

          {filter === 'worksites' && activeWorksite && (
            <div className="worksite-header">
              <button className="worksite-back" onClick={() => setActiveWorksite(null)}>← 现场列表</button>
              <span className="worksite-title-text">{activeWorksite.title}{activeWorksite.archived ? '（已归档）' : ''}</span>
              <span className="worksite-count">{activeWorksite.itemCount} 条记录</span>
            </div>
          )}

          {filter === 'notes' ? (
            <NotesPanel embedded searchQuery={search} />
          ) : filter === 'worksites' && !activeWorksite ? (
            <WorksitesPanel onOpen={handleOpenWorksite} />
          ) : (
            <ItemList
              items={filteredItems} selectedId={selectedId} selectedIds={selectedIds} multiMode={multiMode}
              emptyHint={filter === 'fav' ? '还没有收藏内容' : filter === 'image' ? '还没有图片' : filter === 'text' ? '还没有文字' : '剪贴板为空'}
              onSelect={handleSelect}
              onCopy={handleCopy} onDelete={handleDelete} onToggleFavorite={handleToggleFavorite}
              onEdit={handleEdit} onEditContent={handleEditContent} onOpenEdit={openEditModal} loading={loading} searchQuery={search}
              onEntityClick={handleEntityClick}
            />
          )}

          {multiMode && (
            <div className="batch-bar">
              <span className="batch-count">已选 {selectedIds.size} 条</span>
              <button className="batch-btn" onClick={() => { setSelectedIds(new Set()); setMultiMode(false) }}>取消</button>
              <button className="batch-btn" onClick={() => setSelectedIds(new Set(filteredItems.map(i => i.id)))}>全选</button>
              <button className="batch-btn" onClick={handleCopyAll} disabled={selectedIds.size === 0}>复制全部</button>
              <button className="batch-btn" onClick={handleCopyMarkdown} disabled={selectedIds.size === 0}>Markdown</button>
              <button className="batch-btn" onClick={handleExportMarkdown} disabled={selectedIds.size === 0}>导出</button>
              <button className="batch-btn" onClick={handleWorkOrderDraft} disabled={selectedIds.size === 0}>工单草稿</button>
              {filter === 'worksites' && activeWorksite ? (
                <button className="batch-btn" onClick={handleRemoveFromWorksite} disabled={selectedIds.size === 0}>移出现场</button>
              ) : (
                <button className="batch-btn" onClick={() => setWorksitePickerOpen(true)} disabled={selectedIds.size === 0}>加入现场</button>
              )}
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

      {draftModal && (
        <div className="modal-overlay" onClick={() => setDraftModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">维修工单草稿{draftModal.skipped ? `（${draftModal.skipped} 条已不存在）` : ''}</span>
              <button className="modal-close" onClick={() => setDraftModal(null)}>×</button>
            </div>
            <textarea
              className="modal-textarea"
              value={draftModal.content}
              onChange={e => setDraftModal(m => ({ ...m, content: e.target.value }))}
              placeholder="工单草稿"
            />
            <div className="modal-footer">
              <span className="modal-char-count">{draftModal.content.length} 字</span>
              <div className="modal-actions">
                <button className="btn btn-cancel" onClick={() => setDraftModal(null)}>关闭</button>
                <button className="btn" onClick={() => window.api.copyPlainText({ type: 'text', content: draftModal.content }).then(() => showToast('工单草稿已复制'))}>复制</button>
                <button className="btn btn-save" onClick={() => exportMarkdownContent(draftModal.content)}>导出 Markdown</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {worksitePickerOpen && (
        <WorksitePicker
          onClose={() => setWorksitePickerOpen(false)}
          onPick={handleJoinWorksite}
          onQuickCreate={handleQuickCreateWorksite}
        />
      )}
    </div>
  )
}

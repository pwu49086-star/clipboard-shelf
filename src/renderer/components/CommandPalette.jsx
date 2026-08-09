import { useState, useEffect, useRef, useCallback } from 'react'

const FALLBACK_DIRS = ['D:\\空调资料', 'D:\\空调维修资料', 'E:\\空调资料']

export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [result, setResult] = useState(null)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  const runAI = async (action, title) => {
    setResult({ title, loading: true, text: '', error: null })
    try {
      const text = await window.api.readClipboardText()
      if (!text || !text.trim()) {
        setResult({ title, loading: false, text: '', error: '剪贴板没有文字' })
        return
      }
      const r = await window.api.aiProcess({ action, text })
      setResult({ title, loading: false, text: r?.text || '', error: r?.error || null })
    } catch (e) {
      setResult({ title, loading: false, text: '', error: e.message })
    }
  }

  const runWorkorder = () => runAI('workorder', '生成工单')
  const runTranslate = () => runAI('translate', '翻译当前剪贴板')

  const openDocs = async () => {
    for (const dir of FALLBACK_DIRS) {
      try { if (await window.api.openPath(dir)) return } catch {}
    }
  }

  const clearHistory = async () => {
    if (!window.confirm('确定清空所有非收藏记录？')) return
    try { await window.api.clearHistory(); onClose() } catch {}
  }

  const actions = useCallback(() => {
    const q = query.trim().toLowerCase()
    const list = [
      { id: 'act_workorder', type: 'action', label: '生成工单（当前剪贴板）', hint: 'AI', run: runWorkorder },
      { id: 'act_translate', type: 'action', label: '翻译当前剪贴板', hint: 'AI', run: runTranslate },
      { id: 'act_docs', type: 'action', label: '打开维修资料文件夹', hint: '', run: openDocs },
      { id: 'act_clear', type: 'action', label: '清空非收藏记录', hint: '', run: clearHistory },
      { id: 'act_screenshot', type: 'action', label: '截图', hint: '', run: () => window.api.screenshot() },
      { id: 'act_hide', type: 'action', label: '收起为小宠物', hint: '', run: () => window.api.petMinimize() },
    ]
    if (!q) return list
    return list.filter(a => a.label.toLowerCase().includes(q))
  }, [query])

  const load = useCallback(async (q) => {
    setLoading(true)
    try {
      const [it, nt] = await Promise.all([
        window.api.getAll({ search: q, limit: 20 }),
        window.api.notesGetAll()
      ])
      setItems(it)
      const lq = q.trim().toLowerCase()
      setNotes((nt || []).filter(n =>
        !lq ||
        (n.title || '').toLowerCase().includes(lq) ||
        (n.content || '').toLowerCase().includes(lq)
      ).slice(0, 10))
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResult(null)
    setActive(0)
    load('')
    try { window.api.tasksBump('palette') } catch {}
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [open, load])

  useEffect(() => {
    if (!open) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(query), 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, open, load])

  if (!open) return null

  const results = [
    ...actions(),
    ...items.map(i => ({
      id: 'item_' + i.id,
      type: 'item',
      item: i,
      label: i.content || (i.ocrText || '图片'),
      hint: i.type === 'image' ? '图片' : '历史'
    })),
    ...notes.map(n => ({
      id: 'note_' + n.id,
      type: 'note',
      note: n,
      label: n.title || n.content,
      hint: '便签'
    }))
  ].slice(0, 50)

  const copyItem = async (item) => {
    try {
      await window.api.copyItem(item)
      setResult({ title: '已复制', loading: false, text: (item.content || '图片').slice(0, 120), error: null })
    } catch {}
  }

  const copyText = async (text) => {
    try {
      await window.api.copyItem({ type: 'text', content: text })
      setResult({ title: '已复制', loading: false, text: text.slice(0, 120), error: null })
    } catch {}
  }

  const exec = (r) => {
    if (!r) return
    if (r.type === 'action') { r.run(); return }
    if (r.type === 'item') copyItem(r.item)
    if (r.type === 'note') copyText(r.note.content || r.note.title)
  }

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (result) setResult(null)
      else onClose()
      return
    }
    if (result) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); exec(results[active]) }
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={e => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={onKey}
          placeholder="搜索历史 / 便签 / 命令…  ↑↓ 选择  Enter 执行  Esc 关闭"
        />
        {result ? (
          <div className="palette-result">
            <div className="palette-result-title">{result.title}{result.loading ? '…' : ''}</div>
            {result.loading
              ? <div className="palette-result-loading">处理中…</div>
              : <div className="palette-result-text">{result.error || result.text}</div>}
            {!result.loading && result.text && !result.error && (
              <div className="palette-result-actions">
                <button className="palette-btn" onClick={() => copyText(result.text)}>复制结果</button>
                <button className="palette-btn" onClick={() => setResult(null)}>返回</button>
              </div>
            )}
            {!result.loading && result.error && (
              <button className="palette-btn" onClick={() => setResult(null)}>返回</button>
            )}
          </div>
        ) : (
          <div className="palette-list">
            {loading && <div className="palette-tip">搜索中…</div>}
            {results.length === 0 && !loading && <div className="palette-tip">没有结果</div>}
            {results.map((r, i) => (
              <div
                key={r.id}
                className={`palette-row ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => exec(r)}
              >
                <span className="palette-row-label">{r.label}</span>
                <span className="palette-row-hint">{r.hint}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

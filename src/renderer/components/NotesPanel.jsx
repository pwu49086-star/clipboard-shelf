import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Plus, Pin, Trash2, Copy, X, AlertTriangle, Check } from 'lucide-react'
import { renderMarkdown } from '../markdown'

const COLORS = [
  { name: '黄', value: '#f5f0a8' },
  { name: '绿', value: '#c8f0c8' },
  { name: '蓝', value: '#c8d8f0' },
  { name: '粉', value: '#f0c8d8' },
  { name: '紫', value: '#d8c8f0' },
  { name: '橙', value: '#fde8d0' },
]

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  const month = d.getMonth() + 1
  const day = d.getDate()
  return `${month}/${day}`
}

function toLocalInput(ts) {
  const d = new Date(ts)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatRemind(ts) {
  const d = new Date(ts)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function NotesPanel({ embedded, searchQuery, onBack }) {
  const [notes, setNotes] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editColor, setEditColor] = useState('#f5f0a8')
  const [editRemindAt, setEditRemindAt] = useState(null)
  const [editRemindStr, setEditRemindStr] = useState('')
  const [saveStatus, setSaveStatus] = useState('saved') // saved | saving | error
  const contentRef = useRef(null)
  const saveTimer = useRef(null)

  const reload = useCallback(async () => {
    try {
      const data = await window.api.notesGetAll()
      if (data) setNotes(data)
    } catch (e) { console.error('Load notes failed:', e) }
  }, [])

  useEffect(() => { reload() }, [reload])

  // Auto-save when editing
  useEffect(() => {
    if (!editingId) return
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await window.api.notesUpdate(editingId, { title: editTitle, content: editContent, color: editColor, remindAt: editRemindAt })
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
      }
    }, 800)
    return () => clearTimeout(saveTimer.current)
  }, [editTitle, editContent, editColor, editRemindAt, editingId])

  const handleCreate = useCallback(async () => {
    const note = await window.api.notesCreate({ title: '', content: '', color: '#f5f0a8' })
    if (note) {
      setEditingId(note.id)
      setEditTitle('')
      setEditContent('')
      setEditColor('#f5f0a8')
      setEditRemindAt(null)
      setEditRemindStr('')
      await reload()
      setTimeout(() => contentRef.current?.focus(), 100)
    }
  }, [reload])

  const handleBackFromEdit = useCallback(async () => {
    if (editingId) {
      clearTimeout(saveTimer.current)
      await window.api.notesUpdate(editingId, { title: editTitle, content: editContent, color: editColor, remindAt: editRemindAt })
      if (!editTitle.trim() && !editContent.trim()) {
        await window.api.notesDelete(editingId)
      }
    }
    setEditingId(null)
    await reload()
  }, [editingId, editTitle, editContent, editColor, editRemindAt, reload])

  const handleDelete = useCallback(async (id) => {
    // 删除前先保存当前编辑的内容
    if (editingId === id) {
      clearTimeout(saveTimer.current)
      await window.api.notesUpdate(editingId, { title: editTitle, content: editContent, color: editColor, remindAt: editRemindAt })
      setEditingId(null)
    }
    await window.api.notesDelete(id)
    await reload()
  }, [editingId, editTitle, editContent, editColor, editRemindAt, reload])

  const handleTogglePin = useCallback(async (id) => {
    await window.api.notesTogglePin(id)
    await reload()
  }, [reload])

  const handleCopy = useCallback((content) => {
    window.api.copyItem({ type: 'text', content })
  }, [])

  useEffect(() => {
    if (!embedded) return
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (editingId) handleBackFromEdit()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [embedded, editingId, handleBackFromEdit])

  const filtered = searchQuery
    ? notes.filter(n =>
        (n.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (n.content || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : notes

  const pinned = filtered.filter(n => n.isPinned)
  const unpinned = filtered.filter(n => !n.isPinned)

  // Edit mode
  if (editingId) {
    const currentNote = notes.find(n => n.id === editingId)
    const charCount = editContent.length
    const lineCount = editContent ? editContent.split('\n').length : 0

    return (
      <div className="notes-inline-edit" style={{ background: editColor }}>
        <div className="note-edit-header">
          {embedded ? (
            <button className="settings-back" onClick={handleBackFromEdit}>
              <ArrowLeft size={16} />
            </button>
          ) : (
            <button className="settings-back" onClick={handleBackFromEdit}>
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="note-edit-info">
            {charCount > 0 && <span>{charCount}字{lineCount > 1 ? ` · ${lineCount}行` : ''}</span>}
          </div>
          <div className="note-edit-header-actions">
            {currentNote && (
              <button className="note-edit-action" onClick={() => handleTogglePin(editingId)} title={currentNote.isPinned ? '取消置顶' : '置顶'}>
                <Pin size={14} fill={currentNote.isPinned ? 'currentColor' : 'none'} />
              </button>
            )}
            <button className="note-edit-action" onClick={() => handleCopy(editContent)} title="复制">
              <Copy size={14} />
            </button>
            <button className="note-edit-action delete" onClick={() => handleDelete(editingId)} title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="note-edit-body">
          <input
            className="note-title-input"
            placeholder="标题"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
          />
          <textarea
            ref={contentRef}
            className="note-content-input"
            placeholder="写点什么…"
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
          />
        </div>
        <div className="note-reminder-row">
          <span className="note-reminder-label">提醒</span>
          <input
            type="datetime-local"
            className="note-reminder-input"
            value={editRemindStr}
            onChange={e => {
              setEditRemindStr(e.target.value)
              setEditRemindAt(e.target.value ? new Date(e.target.value).getTime() : null)
            }}
          />
          {editRemindAt && (
            <button className="note-reminder-clear" onClick={() => { setEditRemindAt(null); setEditRemindStr('') }}>清除</button>
          )}
        </div>
        <div className="note-edit-toolbar">
          <div className="note-color-picker">
            {COLORS.map(c => (
              <div
                key={c.value}
                className={`note-color-dot ${editColor === c.value ? 'active' : ''}`}
                style={{ background: c.value }}
                title={c.name}
                onClick={() => setEditColor(c.value)}
              />
            ))}
          </div>
          <span className={`note-edit-saved ${saveStatus}`}>
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'error' ? '保存失败' : '已保存'}
          </span>
        </div>
      </div>
    )
  }

  // List mode
  return (
    <div className="notes-inline">
      <div className="notes-inline-header">
        <span className="notes-inline-count">{notes.length} 条便签</span>
        <button className="notes-inline-add" onClick={handleCreate} title="新建便签">
          <Plus size={14} />
        </button>
      </div>

      <div className="notes-list">
        {filtered.length === 0 && (
          <div className="notes-empty">
            <span style={{ fontSize: 28, marginBottom: 6 }}>📝</span>
            <span>{searchQuery ? '没有匹配的便签' : '点击 + 创建第一条便签'}</span>
          </div>
        )}

        {pinned.length > 0 && (
          <>
            <div className="notes-section-title">📌 已置顶</div>
            {pinned.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                onEdit={() => {
                  setEditingId(note.id)
                  setEditTitle(note.title)
                  setEditContent(note.content)
                  setEditColor(note.color)
              setEditRemindAt(note.remindAt || null)
              setEditRemindStr(note.remindAt ? toLocalInput(note.remindAt) : '')
                  setEditRemindAt(note.remindAt || null)
                  setEditRemindStr(note.remindAt ? toLocalInput(note.remindAt) : '')
                }}
                onDelete={() => handleDelete(note.id)}
                onTogglePin={() => handleTogglePin(note.id)}
                onCopy={() => handleCopy(note.content)}
              />
            ))}
          </>
        )}

        {unpinned.length > 0 && pinned.length > 0 && (
          <div className="notes-section-title">其他</div>
        )}
        {unpinned.map(note => (
          <NoteCard
            key={note.id}
            note={note}
            onEdit={() => {
              setEditingId(note.id)
              setEditTitle(note.title)
              setEditContent(note.content)
              setEditColor(note.color)
              setEditRemindAt(note.remindAt || null)
              setEditRemindStr(note.remindAt ? toLocalInput(note.remindAt) : '')
            }}
            onDelete={() => handleDelete(note.id)}
            onTogglePin={() => handleTogglePin(note.id)}
            onCopy={() => handleCopy(note.content)}
          />
        ))}
      </div>
    </div>
  )
}

function NoteCard({ note, onEdit, onDelete, onTogglePin, onCopy }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const timer = useRef(null)

  const handleDelete = (e) => {
    e.stopPropagation()
    if (confirmDelete) {
      clearTimeout(timer.current)
      setConfirmDelete(false)
      onDelete()
    } else {
      setConfirmDelete(true)
      timer.current = setTimeout(() => setConfirmDelete(false), 2000)
    }
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <div
      className={`note-card ${note.isPinned ? 'pinned' : ''}`}
      style={{ background: note.color }}
      onClick={onEdit}
    >
      <div className="note-card-header">
        <span className="note-card-title">{note.title || '无标题'}</span>
        <div className="note-card-actions">
          <button className="note-card-btn" onClick={(e) => { e.stopPropagation(); onTogglePin() }} title={note.isPinned ? '取消置顶' : '置顶'}>
            <Pin size={12} fill={note.isPinned ? '#555' : 'none'} />
          </button>
          <button className="note-card-btn" onClick={(e) => { e.stopPropagation(); onCopy() }} title="复制">
            <Copy size={12} />
          </button>
          <button className={`note-card-btn ${confirmDelete ? 'confirm-delete' : 'delete'}`} onClick={handleDelete} title={confirmDelete ? '确认删除' : '删除'}>
            {confirmDelete ? <AlertTriangle size={12} /> : <Trash2 size={12} />}
          </button>
        </div>
      </div>
      <div className="note-card-content markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content || '空便签') }} />
      <div className="note-card-time">
        {note.remindAt && !note.reminded && <span className="note-reminder-badge">⏰ {formatRemind(note.remindAt)}</span>}
        {formatTime(note.updateTime)}
      </div>
    </div>
  )
}

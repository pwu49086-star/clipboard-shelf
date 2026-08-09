import { memo, useCallback, useState, useRef, useEffect } from 'react'
import { FileText, Image, Copy, Star, Trash2, AlertTriangle, ClipboardCopy, Pin } from 'lucide-react'

function formatTime(ts) {
  const now = Date.now()
  const diff = now - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}时前`
  const d = new Date(ts)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  if (new Date().getFullYear() === d.getFullYear()) {
    return `${month}/${day} ${h}:${m}`
  }
  return `${d.getFullYear()}/${month}/${day}`
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1048576).toFixed(1) + 'MB'
}

function truncateText(text, maxLen = 120) {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

function highlightText(text, query) {
  if (!query || !text) return text
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const parts = []
  let lastIdx = 0
  let idx = lowerText.indexOf(lowerQuery, lastIdx)
  while (idx !== -1) {
    if (idx > lastIdx) parts.push(text.slice(lastIdx, idx))
    parts.push(<mark key={idx} className="hl">{text.slice(idx, idx + query.length)}</mark>)
    lastIdx = idx + query.length
    idx = lowerText.indexOf(lowerQuery, lastIdx)
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return parts.length ? <>{parts}</> : text
}

const ItemRow = memo(function ItemRow({ item, isSelected, multiMode, onSelect, onCopy, onDelete, onToggleFavorite, onEdit, onEditContent, onOpenEdit, searchQuery }) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copyFlash, setCopyFlash] = useState(false)
  const confirmTimer = useRef(null)
  const editRef = useRef(null)

  const isImage = item.type === 'image'
  const handleRowClick = useCallback((e) => {
    if (isImage && !e?.shiftKey && !e?.ctrlKey) {
      onEdit(item)
    } else {
      onSelect(item.id, e?.shiftKey, e?.ctrlKey)
    }
  }, [isImage, onEdit, onSelect, item])
  const handleTextClick = useCallback((e) => {
    if (item.type !== 'text') return
    e.stopPropagation()
    const text = item.content || ''
    const lines = text.split('\n').length
    if (text.length <= 80 && lines <= 2) {
      setEditText(text)
      setEditing(true)
    } else {
      if (onOpenEdit) onOpenEdit(item)
    }
  }, [item, onOpenEdit])

  const handleEditSave = useCallback(() => {
    if (editText !== (item.content || '')) {
      window.api.editItem(item.id, editText)
      if (onEditContent) onEditContent(item.id, editText)
    }
    setEditing(false)
  }, [editText, item, onEditContent])

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus()
      editRef.current.select()
    }
  }, [editing])

  const handleDragStart = useCallback((e) => {
    if (item.type === 'image') {
      e.preventDefault()
      window.api.startDrag(item)
    } else {
      e.dataTransfer.setData('text/plain', item.content || '')
      e.dataTransfer.effectAllowed = 'copy'
    }
  }, [item])

  const handleCopy = useCallback((e) => {
    e.stopPropagation()
    setCopyFlash(true)
    setTimeout(() => setCopyFlash(false), 250)
    onCopy(item)
  }, [onCopy, item])

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    if (confirmDelete) {
      clearTimeout(confirmTimer.current)
      setConfirmDelete(false)
      onDelete(item.id)
    } else {
      setConfirmDelete(true)
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 2000)
    }
  }, [onDelete, confirmDelete, item.id])

  useEffect(() => {
    return () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }
  }, [])

  const handleFavorite = useCallback((e) => {
    e.stopPropagation()
    onToggleFavorite(item.id)
  }, [onToggleFavorite, item.id])

  const handlePin = useCallback((e) => {
    e.stopPropagation()
    if (item.filePath) window.api.pinImage(item.filePath)
  }, [item.filePath])

  

  const rawText = isImage ? (item.ocrText || '') : (item.content || '')
  const displayText = truncateText(rawText, 100)

  // 元信息
  const meta = []
  meta.push(formatTime(item.createTime))
  if (!isImage && item.content) {
    const lines = item.content.split('\n').length
    const chars = item.content.length
    meta.push(lines > 1 ? `${lines}行 · ${chars}字` : `${chars}字`)
  }
  if (isImage && item.fileSize) {
    meta.push(formatSize(item.fileSize))
  }
  if (isImage && item.imageWidth && item.imageHeight) {
    meta.push(`${item.imageWidth}×${item.imageHeight}`)
  }

  return (
    <div
      className={`item-row ${isSelected ? 'selected' : ''} ${isImage ? 'has-image' : ''} ${copyFlash ? 'item-copy-flash' : ''}`}
      onClick={handleRowClick}
      onDoubleClick={isImage ? undefined : (e) => { e.stopPropagation(); setCopyFlash(true); setTimeout(() => setCopyFlash(false), 400); onCopy(item) }}
      draggable={!multiMode}
      onDragStart={handleDragStart}
    >
      {multiMode ? (
        <span className={`item-checkbox ${isSelected ? 'checked' : ''}`}>
          {isSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
        </span>
      ) : (
        <span className={`item-type ${isImage ? 'image' : ''}`}>
          {isImage ? <Image size={16} strokeWidth={1.75} /> : <FileText size={16} strokeWidth={1.75} />}
        </span>
      )}

      <div className="item-body">
        {isImage && item.thumbPath && (
          <img
            className="item-thumb"
            src={`shelf-file://thumb/${item.thumbPath.replace(/\\/g, '/').split('/').pop()}`}
            alt=""
            draggable={false}
            onError={(e) => { e.target.style.display='none' }}
          />
        )}

        <div className="item-content" onClick={isImage ? undefined : handleTextClick}>
          {editing ? (
            <input
              ref={editRef}
              className="item-inline-edit"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onBlur={handleEditSave}
              onKeyDown={e => {
                if (e.key === 'Escape') setEditing(false)
                if (e.key === 'Enter') { e.preventDefault(); handleEditSave() }
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <div className={`item-text ${isImage ? '' : 'multiline'}`}>
              {searchQuery ? highlightText(displayText, searchQuery) : displayText}
            </div>
          )}
          <div className="item-meta">
            {meta.map((m, i) => <span key={i}>{m}</span>)}
            {isImage && item.ocrText && (
              <span className="item-ocr-badge" title="点击复制识别文字" onClick={(e) => {
                e.stopPropagation()
                window.api.copyItem({ type: 'text', content: item.ocrText })
              }}>
                <ClipboardCopy size={11} /> OCR
              </span>
            )}
          </div>
        </div>
      </div>

      {item.isFavorite === 1 && (
        <span className="item-favorite-indicator">
          <Star size={12} fill="currentColor" />
        </span>
      )}

      <div className="item-actions">
        <button className="item-action-btn" onClick={handleCopy} title="复制">
          <Copy size={13} />
        </button>
        <button
          className={`item-action-btn ${item.isFavorite ? 'favorite' : ''}`}
          onClick={handleFavorite}
          title="收藏"
        >
          <Star size={13} fill={item.isFavorite ? 'currentColor' : 'none'} />
        </button>
        <button className={`item-action-btn ${confirmDelete ? 'confirm-delete' : 'delete'}`} onClick={handleDelete} title={confirmDelete ? '确认删除' : '删除'}>
          {confirmDelete ? <AlertTriangle size={13} /> : <Trash2 size={13} />}
        </button>
      </div>
      
    </div>
  )
})
export default ItemRow

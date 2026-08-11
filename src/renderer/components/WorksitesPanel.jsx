import { useState, useEffect, useCallback } from 'react'

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (now - d < 60000) return '刚刚'
  if (now - d < 3600000) return `${Math.floor((now - d) / 60000)}分钟前`
  if (now - d < 86400000) return `${Math.floor((now - d) / 3600000)}小时前`
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${m}/${day}`
}

export default function WorksitesPanel({ onOpen }) {
  const [list, setList] = useState([])
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try { setList(await window.api.worksitesList()) } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    const ws = await window.api.worksitesCreate({ title, note })
    if (!ws) { setMsg('现场名称不能为空'); return }
    setCreating(false)
    setTitle('')
    setNote('')
    setMsg('')
    load()
  }

  const rename = async (id) => {
    const t = renameTitle.trim()
    if (!t) return
    await window.api.worksitesUpdate(id, { title: t })
    setRenamingId(null)
    load()
  }

  const toggleArchive = async (ws) => {
    await window.api.worksitesUpdate(ws.id, { archived: ws.archived ? 0 : 1 })
    load()
  }

  const remove = async (ws) => {
    if (!window.confirm(`删除现场「${ws.title}」？将解除 ${ws.itemCount} 条记录的关联，不删除记录。`)) return
    await window.api.worksitesDelete(ws.id)
    load()
  }

  return (
    <div className="worksites-panel">
      <div className="worksites-toolbar">
        <button className="btn" onClick={() => setCreating(c => !c)}>{creating ? '取消' : '+ 新建现场'}</button>
        {msg && <span className="worksites-msg">{msg}</span>}
      </div>

      {creating && (
        <div className="worksite-create">
          <input
            className="ws-input"
            placeholder="现场名称（必填）"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
          <input
            className="ws-input"
            placeholder="备注（客户/地址，可选）"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <button className="btn btn-save" onClick={create}>创建</button>
        </div>
      )}

      {list.length === 0 && !creating && (
        <div className="worksites-empty">还没有现场。多选记录后点「加入现场」即可创建。</div>
      )}

      {list.map(ws => (
        <div key={ws.id} className={`worksite-row ${ws.archived ? 'archived' : ''}`} onClick={() => onOpen(ws)}>
          <div className="worksite-main">
            {renamingId === ws.id ? (
              <input
                className="ws-input"
                value={renameTitle}
                autoFocus
                onChange={e => setRenameTitle(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter') rename(ws.id)
                  if (e.key === 'Escape') setRenamingId(null)
                }}
              />
            ) : (
              <span className="worksite-title-text">{ws.title}{ws.archived ? '（已归档）' : ''}</span>
            )}
            <span className="worksite-count">{ws.itemCount} 条记录</span>
            {ws.note && <span className="worksite-note">{ws.note}</span>}
            {ws.lastItemTime && <span className="worksite-time">{fmtTime(ws.lastItemTime)}</span>}
          </div>
          <div className="worksite-actions" onClick={e => e.stopPropagation()}>
            {renamingId === ws.id ? (
              <button className="item-action-btn" title="保存" onClick={() => rename(ws.id)}>✓</button>
            ) : (
              <button className="item-action-btn" title="重命名" onClick={() => { setRenamingId(ws.id); setRenameTitle(ws.title) }}>✎</button>
            )}
            <button className="item-action-btn" title={ws.archived ? '取消归档' : '归档'} onClick={() => toggleArchive(ws)}>
              {ws.archived ? '↩' : '📁'}
            </button>
            <button className="item-action-btn delete" title="删除现场" onClick={() => remove(ws)}>🗑</button>
          </div>
        </div>
      ))}
    </div>
  )
}

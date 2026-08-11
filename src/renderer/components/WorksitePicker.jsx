import { useState, useEffect, useCallback } from 'react'

export default function WorksitePicker({ onClose, onPick, onQuickCreate }) {
  const [list, setList] = useState([])
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setList(await window.api.worksitesList()) } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const quickCreate = async () => {
    setBusy(true)
    setError('')
    const r = await onQuickCreate(title, note)
    setBusy(false)
    if (!r || !r.ok) {
      setError((r && r.error) || '创建失败')
      return
    }
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">加入现场</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="ws-picker-list">
          {list.length === 0 && <div className="worksites-empty">还没有现场，可直接创建。</div>}
          {list.map(ws => (
            <button key={ws.id} className="ws-picker-row" onClick={() => onPick(ws)}>
              <span className="ws-picker-name">{ws.title}{ws.archived ? '（已归档）' : ''}</span>
              <span className="ws-picker-count">{ws.itemCount} 条</span>
            </button>
          ))}
        </div>
        <div className="ws-picker-create">
          <input
            className="ws-input"
            placeholder="新建现场名称（必填）"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <input
            className="ws-input"
            placeholder="备注（可选）"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <button className="btn btn-save" disabled={busy} onClick={quickCreate}>创建并加入</button>
        </div>
        {error && <div className="ws-picker-error">{error}</div>}
      </div>
    </div>
  )
}

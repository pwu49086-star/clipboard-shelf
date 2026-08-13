import { useEffect, useRef, useState, useCallback } from 'react'
import { createStore } from '../../shared/annotation-store.cjs'
import { fitRect, displayPointToNative, nativePointToDisplay, mosaicBlocks, buildDrawOps } from '../../shared/annotation-geometry.cjs'

const TOOLS = [
  { id: 'rect', label: '矩形' },
  { id: 'arrow', label: '箭头' },
  { id: 'text', label: '文字' },
  { id: 'pen', label: '涂鸦' },
  { id: 'mosaic', label: '马赛克' }
]

function fileBase(p) {
  return String(p || '').replace(/\\/g, '/').split('/').pop()
}

function fillMosaicBlocks(ctx, blocks) {
  for (const b of blocks) {
    const w = Math.max(1, Math.round(b.w))
    const h = Math.max(1, Math.round(b.h))
    const data = ctx.getImageData(Math.round(b.x), Math.round(b.y), w, h).data
    let r = 0; let g = 0; let bl = 0
    const n = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; bl += data[i + 2]
    }
    if (n > 0) {
      ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(bl / n)})`
      ctx.fillRect(Math.round(b.x), Math.round(b.y), w, h)
    }
  }
}

function applyElement(ctx, el) {
  ctx.save()
  ctx.strokeStyle = el.color || '#e11'
  ctx.fillStyle = el.color || '#e11'
  ctx.lineWidth = el.strokeWidth || 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (el.kind === 'rect') {
    const a = el.points[0]; const b = el.points[1] || a
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  } else if (el.kind === 'arrow') {
    const a = el.points[0]; const b = el.points[1] || a
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const len = 14
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - len * Math.cos(ang - 0.45), b.y - len * Math.sin(ang - 0.45))
    ctx.lineTo(b.x - len * Math.cos(ang + 0.45), b.y - len * Math.sin(ang + 0.45))
    ctx.closePath()
    ctx.fill()
  } else if (el.kind === 'text') {
    const p = el.points[0] || { x: 0, y: 0 }
    ctx.font = `bold ${el.fontSize || 32}px "Microsoft YaHei", sans-serif`
    ctx.fillText(el.text || '', p.x, p.y)
  } else if (el.kind === 'path' || el.kind === 'pen') {
    const pts = el.points || []
    if (pts.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function opToElement(op) {
  switch (op.op) {
    case 'rect': return { kind: 'rect', points: [{ x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 }], color: op.color, strokeWidth: op.strokeWidth }
    case 'arrow': return { kind: 'arrow', points: [{ x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 }], color: op.color, strokeWidth: op.strokeWidth }
    case 'text': return { kind: 'text', points: [{ x: op.x, y: op.y }], text: op.text, fontSize: op.fontSize, color: op.color }
    case 'path': return { kind: 'path', points: op.points, color: op.color, strokeWidth: op.strokeWidth }
    default: return { kind: 'rect', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
  }
}

export default function ImageAnnotator({ item, onClose, onSaved }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const storeRef = useRef(createStore())
  const imgNatural = useRef(null)
  const baseAnnotated = useRef(false)
  const dragRef = useRef(null)
  const spaceRef = useRef(false)
  const [tool, setTool] = useState('rect')
  const [color, setColor] = useState('#e11')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [baseSrc, setBaseSrc] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [textDraft, setTextDraft] = useState(null)
  const [textValue, setTextValue] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelBusy, setPanelBusy] = useState(false)
  const [panel, setPanel] = useState(null)
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion(v => v + 1), [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !imgNatural.current) return
    const ctx = canvas.getContext('2d')
    const vp = { width: canvas.clientWidth, height: canvas.clientHeight }
    canvas.width = vp.width
    canvas.height = vp.height
    const fit = fitRect(imgNatural.current, vp, zoom, pan)
    ctx.clearRect(0, 0, vp.width, vp.height)
    ctx.save()
    ctx.translate(fit.x, fit.y)
    ctx.scale(fit.scale, fit.scale)
    ctx.drawImage(img, 0, 0)
    ctx.restore()

    for (const el of storeRef.current.getElements()) {
      if (el.kind !== 'mosaic') continue
      const dispBlocks = mosaicBlocks(el).map(b => ({
        x: b.x * fit.scale + fit.x,
        y: b.y * fit.scale + fit.y,
        w: b.w * fit.scale,
        h: b.h * fit.scale
      }))
      fillMosaicBlocks(ctx, dispBlocks)
    }

    ctx.save()
    ctx.translate(fit.x, fit.y)
    ctx.scale(fit.scale, fit.scale)
    for (const el of storeRef.current.getElements()) {
      if (el.kind === 'mosaic') continue
      applyElement(ctx, el)
    }
    const drag = dragRef.current
    if (drag && drag.tool && drag.current && drag.tool !== 'text') {
      applyElement(ctx, { kind: drag.tool, points: [drag.start, drag.current], color, strokeWidth: 3, fontSize: 32 })
    }
    ctx.restore()
  }, [zoom, pan, color])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await window.api.annotationsGet(item.id)
        if (cancelled) return
        const hasAnnotated = !!(r && r.ok && r.annotatedPath)
        baseAnnotated.current = hasAnnotated
        const src = hasAnnotated
          ? 'shelf-file://annotated/' + fileBase(r.annotatedPath)
          : 'shelf-file://full/' + fileBase(item.filePath)
        const all = (r && r.ok ? r.elements : []) || []
        const flatMosaic = all.some(e => e.kind === 'mosaic' && e.flattened)
        const live = all.filter(e => !(e.kind === 'mosaic' && e.flattened))
        storeRef.current = createStore({ elements: live, mosaicLocked: flatMosaic })
        setBaseSrc(src)
        const blob = await fetch(src).then(res => res.blob())
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => {
          imgRef.current = img
          imgNatural.current = { width: img.naturalWidth, height: img.naturalHeight }
          setLoading(false)
          bump()
        }
        img.src = url
      } catch (e) {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [item.id])

  useEffect(() => { draw() }, [draw, version, baseSrc, textDraft])

  useEffect(() => {
    const down = (e) => { if (e.code === 'Space') spaceRef.current = true }
    const up = (e) => { if (e.code === 'Space') spaceRef.current = false }
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) { if (storeRef.current.redo()) bump() }
        else { if (storeRef.current.undo()) bump() }
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('keydown', key)
    }
  }, [])

  const nativePoint = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const fit = fitRect(imgNatural.current, { width: canvas.clientWidth, height: canvas.clientHeight }, zoom, pan)
    return displayPointToNative({ x: e.clientX - rect.left, y: e.clientY - rect.top }, fit)
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    const p = nativePoint(e)
    if (spaceRef.current) {
      dragRef.current = { pan: true, start: { x: e.clientX, y: e.clientY }, panStart: { ...pan } }
      return
    }
    if (tool === 'text') {
      setTextDraft(p)
      setTextValue('')
      return
    }
    dragRef.current = { tool, start: p, current: p, points: [p] }
  }

  const onPointerMove = (e) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.pan) {
      setPan({ x: drag.panStart.x + (e.clientX - drag.start.x), y: drag.panStart.y + (e.clientY - drag.start.y) })
      return
    }
    const p = nativePoint(e)
    drag.current = p
    if (drag.tool === 'pen') drag.points.push(p)
    draw()
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.pan) return
    if (drag.tool === 'pen') {
      if (drag.points.length >= 2) {
        storeRef.current.add({ id: `e${Date.now()}`, kind: 'pen', points: drag.points, color, strokeWidth: 3 })
        bump()
      }
      return
    }
    storeRef.current.add({
      id: `e${Date.now()}`,
      kind: drag.tool,
      points: [drag.start, drag.current],
      color,
      strokeWidth: 3,
      blockSize: 16
    })
    bump()
  }

  const onWheel = (e) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    setZoom(z => Math.min(8, Math.max(0.2, z * factor)))
  }

  const commitText = () => {
    if (!textDraft || !textValue.trim()) { setTextDraft(null); return }
    storeRef.current.add({
      id: `e${Date.now()}`,
      kind: 'text',
      points: [textDraft],
      text: textValue.trim(),
      fontSize: 32,
      color
    })
    setTextDraft(null)
    bump()
  }

  const doOcr = async () => {
    if (!item || !item.filePath) { setPanel({ label: '提取文字', result: '没有可用原图' }); return }
    setPanelBusy(true)
    try {
      const text = await window.api.ocrRecognizePath(item.filePath)
      const result = (text || '').trim()
      setPanel({ label: '识别结果', result: result || '未识别到文字' })
    } catch {
      setPanel({ label: '提取文字', result: '识别失败' })
    } finally {
      setPanelBusy(false)
    }
  }

  const doTranslate = async () => {
    if (!item || !item.filePath) { setPanel({ label: '翻译结果', result: '没有可用原图' }); return }
    setPanelBusy(true)
    try {
      const text = await window.api.ocrRecognizePath(item.filePath)
      const ocr = (text || '').trim()
      if (!ocr) { setPanel({ label: '翻译结果', result: '未识别到文字' }); return }
      const hasChinese = /[\u4e00-\u9fa5]/.test(ocr)
      const translated = await window.api.translateText(ocr, hasChinese ? 'zh' : 'en', hasChinese ? 'en' : 'zh')
      setPanel({ label: '原文', result: ocr, translated: translated || '翻译失败' })
    } catch {
      setPanel({ label: '翻译结果', result: '翻译失败' })
    } finally {
      setPanelBusy(false)
    }
  }

  const runAI = async (action) => {
    const src = (panel && panel.result) || ''
    if (!src) return
    setPanelBusy(true)
    try {
      const r = await window.api.aiProcess({ action, text: src })
      const label = action === 'summary' ? 'AI 总结' : action === 'explain' ? 'AI 解释' : '工单草稿'
      setPanel(p => ({ ...(p || {}), label, result: (r && r.text) || (r && r.error) || '处理失败' }))
    } catch {
      setPanel(p => ({ ...(p || {}), result: '处理失败' }))
    } finally {
      setPanelBusy(false)
    }
  }

  const copyText = async (text) => {
    try {
      if (window.api && window.api.writeClipboardText) {
        await window.api.writeClipboardText(text || '')
      } else {
        await navigator.clipboard.writeText(text || '')
      }
    } catch {}
  }

  const flashCopied = (el) => {
    if (!el) return
    el.classList.add('flash-copied')
    setTimeout(() => el.classList.remove('flash-copied'), 600)
  }

  const segmentWords = (text) => {
    try {
      const seg = new Intl.Segmenter('zh-Hans', { granularity: 'word' })
      return [...seg.segment(text)].map(s => ({ text: s.segment, wordLike: !!s.isWordLike }))
    } catch {
      return String(text).split(/(\s+)/).map(part => ({ text: part, wordLike: /\S/.test(part) }))
    }
  }

  const renderClickableText = (text) => {
    if (!text) return null
    return String(text).split('\n').map((line, li) => (
      <div
        key={li}
        className="annotator-line"
        title="点击空白处复制整行"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            copyText(line)
            flashCopied(e.currentTarget)
          }
        }}
      >
        {line
          ? segmentWords(line).map((part, pi) => part.wordLike ? (
            <span
              key={pi}
              className="annotator-token"
              title="点击复制该词"
              onClick={(e) => {
                e.stopPropagation()
                copyText(part.text)
                flashCopied(e.currentTarget)
              }}
            >
              {part.text}
            </span>
          ) : (
            <span key={pi}>{part.text}</span>
          ))
          : '\u00A0'}
      </div>
    ))
  }

  const save = async () => {
    if (!imgNatural.current) return
    setSaving(true)
    try {
      const native = imgNatural.current
      const off = document.createElement('canvas')
      off.width = native.width
      off.height = native.height
      const octx = off.getContext('2d')
      octx.drawImage(imgRef.current, 0, 0)
      const { ops } = buildDrawOps(storeRef.current.getElements(), native)
      for (const op of ops) {
        if (op.op === 'mosaic') fillMosaicBlocks(octx, op.blocks)
        else applyElement(octx, opToElement(op))
      }
      const pngBase64 = off.toDataURL('image/png').split(',')[1]
      const r = await window.api.annotationsSave({
        itemId: item.id,
        elements: storeRef.current.getElements(),
        pngBase64
      })
      if (r && r.ok) {
        if (onSaved) onSaved(r)
        onClose()
      } else {
        window.alert((r && r.error) || '保存失败')
      }
    } catch (e) {
      window.alert('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const textPos = (() => {
    if (!textDraft || !imgNatural.current || !canvasRef.current) return null
    const fit = fitRect(imgNatural.current, { width: canvasRef.current.clientWidth, height: canvasRef.current.clientHeight }, zoom, pan)
    const p = nativePointToDisplay(textDraft, fit)
    return { left: p.x, top: p.y }
  })()

  return (
    <div className="modal-overlay annotator-overlay" onClick={onClose}>
      <div className="modal annotator-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">图片标注{baseAnnotated.current ? '（标注图基础上）' : ''}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="annotator-toolbar">
          {TOOLS.map(t => (
            <button key={t.id} className={`annotator-tool ${tool === t.id ? 'active' : ''}`} onClick={() => setTool(t.id)}>
              {t.label}
            </button>
          ))}
          <button className={`annotator-tool ${panelOpen ? 'active' : ''}`} onClick={() => setPanelOpen(v => !v)}>提取/翻译</button>
          <input type="color" className="annotator-color" value={color} onChange={e => setColor(e.target.value)} title="颜色" />
          <button className="annotator-tool" onClick={() => { if (storeRef.current.undo()) bump() }} disabled={!storeRef.current.canUndo()}>撤销</button>
          <button className="annotator-tool" onClick={() => { if (storeRef.current.redo()) bump() }} disabled={!storeRef.current.canRedo()}>重做</button>
          <button className="annotator-tool" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>适应</button>
          <span className="annotator-hint">滚轮缩放 · 空格+拖动平移 · Ctrl+Z 撤销</span>
        </div>
        <div className="annotator-stage">
          {loading && <div className="annotator-loading">加载图片…</div>}
          <canvas
            ref={canvasRef}
            className="annotator-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          />
          {textDraft && textPos && (
            <input
              className="annotator-text-input"
              style={{ left: textPos.left, top: textPos.top }}
              autoFocus
              value={textValue}
              placeholder="文字，回车确认"
              onChange={e => setTextValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextDraft(null) }}
            />
          )}
          {panelOpen && (
            <div className="annotator-panel">
              <div className="annotator-panel-header">
                <span>提取/翻译</span>
                <button className="annotator-panel-close" onClick={() => setPanelOpen(false)}>×</button>
              </div>
              <div className="annotator-panel-actions">
                <button onClick={doOcr} disabled={panelBusy}>提取文字</button>
                <button onClick={doTranslate} disabled={panelBusy}>翻译</button>
              </div>
              {panelBusy && <div className="annotator-panel-loading">处理中…</div>}
              {!panelBusy && panel && (
                <div className="annotator-panel-body">
                  <div className="annotator-panel-label">{panel.label}</div>
                  <div className="annotator-panel-text">{renderClickableText(panel.result)}</div>
                  <div className="annotator-panel-btnrow">
                    <button onClick={() => copyText(panel.result)}>复制</button>
                    <button onClick={() => runAI('summary')} disabled={!panel.result}>AI 总结</button>
                    <button onClick={() => runAI('explain')} disabled={!panel.result}>AI 解释</button>
                    <button onClick={() => runAI('workorder')} disabled={!panel.result}>生成工单</button>
                  </div>
                  {panel.translated && (
                    <>
                      <div className="annotator-panel-label">译文</div>
                      <div className="annotator-panel-text">{renderClickableText(panel.translated)}</div>
                      <div className="annotator-panel-btnrow">
                        <button onClick={() => copyText(panel.translated)}>复制译文</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {!panelBusy && !panel && (
                <div className="annotator-panel-body">
                  <div className="annotator-panel-label">提示</div>
                  <div className="annotator-panel-text">对当前图片原图执行 OCR 提取文字、翻译或 AI 处理；不会修改原图。</div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="modal-char-count">
            {storeRef.current.isMosaicLocked() ? '马赛克已锁定（不可撤销/删除）' : `${storeRef.current.getElements().length} 个标注`}
          </span>
          <div className="modal-actions">
            <button className="btn btn-cancel" onClick={onClose} disabled={saving}>取消</button>
            <button className="btn btn-save" onClick={save} disabled={saving || loading}>{saving ? '保存中…' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

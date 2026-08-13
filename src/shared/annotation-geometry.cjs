/**
 * 图片标注几何与绘制指令（纯逻辑，无 DOM 依赖）。
 * 坐标一律使用原图像素坐标。
 */

function nativeToDisplay(p, nativeSize, displaySize) {
  return {
    x: p.x * displaySize.width / nativeSize.width,
    y: p.y * displaySize.height / nativeSize.height
  }
}

function displayToNative(p, nativeSize, displaySize) {
  return {
    x: p.x * nativeSize.width / displaySize.width,
    y: p.y * nativeSize.height / displaySize.height
  }
}

/**
 * 计算画布内图片的绘制矩形（fit + zoom + pan）。
 */
function fitRect(nativeSize, viewportSize, zoom = 1, pan = { x: 0, y: 0 }) {
  const scale = Math.min(
    viewportSize.width / nativeSize.width,
    viewportSize.height / nativeSize.height
  ) * zoom
  const w = nativeSize.width * scale
  const h = nativeSize.height * scale
  return {
    x: (viewportSize.width - w) / 2 + pan.x,
    y: (viewportSize.height - h) / 2 + pan.y,
    w,
    h,
    scale
  }
}

function displayPointToNative(p, fit) {
  return { x: (p.x - fit.x) / fit.scale, y: (p.y - fit.y) / fit.scale }
}

function nativePointToDisplay(p, fit) {
  return { x: p.x * fit.scale + fit.x, y: p.y * fit.scale + fit.y }
}

function rectFromPoints(points) {
  const a = points[0] || { x: 0, y: 0 }
  const b = points[1] || a
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y)
  }
}

function mosaicBlocks(el) {
  const r = rectFromPoints(el.points)
  const blockSize = Math.max(4, Math.floor(el.blockSize || 16))
  const blocks = []
  for (let y = r.y1; y < r.y2; y += blockSize) {
    for (let x = r.x1; x < r.x2; x += blockSize) {
      blocks.push({
        x,
        y,
        w: Math.min(blockSize, r.x2 - x),
        h: Math.min(blockSize, r.y2 - y)
      })
    }
  }
  return blocks
}

function elementOps(el) {
  switch (el.kind) {
    case 'rect': {
      const r = rectFromPoints(el.points)
      return [{ op: 'rect', ...r, color: el.color, strokeWidth: el.strokeWidth }]
    }
    case 'arrow': {
      const a = el.points[0] || { x: 0, y: 0 }
      const b = el.points[1] || a
      return [{ op: 'arrow', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: el.color, strokeWidth: el.strokeWidth }]
    }
    case 'text': {
      const p = el.points[0] || { x: 0, y: 0 }
      return [{ op: 'text', x: p.x, y: p.y, text: el.text || '', fontSize: el.fontSize || 32, color: el.color }]
    }
    case 'pen': {
      return [{ op: 'path', points: (el.points || []).map(p => ({ x: p.x, y: p.y })), color: el.color, strokeWidth: el.strokeWidth }]
    }
    default:
      return []
  }
}

/**
 * 生成绘制指令序列。马赛克永远排在最前（遮挡原图），其余元素按原顺序。
 */
function buildDrawOps(elements, imageSize) {
  const list = Array.isArray(elements) ? elements : []
  const ops = []
  for (const el of list) {
    if (el.kind === 'mosaic') {
      ops.push({ op: 'mosaic', blocks: mosaicBlocks(el), blockSize: Math.max(4, Math.floor(el.blockSize || 16)) })
    }
  }
  for (const el of list) {
    if (el.kind !== 'mosaic') ops.push(...elementOps(el))
  }
  return { ops, imageSize: { width: imageSize.width, height: imageSize.height } }
}

function hitTestElement(el, point) {
  if (!el || !point) return false
  if (el.kind === 'text') {
    const p = el.points[0] || { x: 0, y: 0 }
    const w = (el.text || '').length * el.fontSize * 0.6
    return point.x >= p.x && point.x <= p.x + w && point.y >= p.y - el.fontSize && point.y <= p.y
  }
  const r = rectFromPoints(el.points)
  return point.x >= r.x1 && point.x <= r.x2 && point.y >= r.y1 && point.y <= r.y2
}

module.exports = {
  nativeToDisplay,
  displayToNative,
  fitRect,
  displayPointToNative,
  nativePointToDisplay,
  rectFromPoints,
  mosaicBlocks,
  elementOps,
  buildDrawOps,
  hitTestElement
}

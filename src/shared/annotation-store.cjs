/**
 * 标注元素状态机（纯逻辑，可单测）。
 * 马赛克特殊规则：
 *  - 添加后 flattened=true
 *  - 不允许删除
 *  - 添加时清空 past（不允许 undo 回到 mosaic 之前）与 future
 */

function createStore({ elements = [], mosaicLocked = false } = {}) {
  let list = (elements || []).map(e => ({ ...e }))
  let past = []
  let future = []
  let locked = mosaicLocked || list.some(e => e.kind === 'mosaic' && e.flattened)

  function add(el) {
    if (!el || !el.kind) return null
    const item = { ...el }
    if (item.kind === 'mosaic') {
      item.flattened = true
      past = []
      future = []
      locked = true
    } else {
      future = []
      past = [...past, list]
    }
    list = [...list, item]
    return item
  }

  function remove(id) {
    const el = list.find(e => e.id === id)
    if (!el || el.kind === 'mosaic') return false
    past = [...past, list]
    list = list.filter(e => e.id !== id)
    future = []
    return true
  }

  function undo() {
    if (past.length === 0) return false
    future = [list, ...future]
    list = past[past.length - 1]
    past = past.slice(0, -1)
    return true
  }

  function redo() {
    if (future.length === 0) return false
    past = [...past, list]
    list = future[0]
    future = future.slice(1)
    return true
  }

  return {
    add,
    remove,
    undo,
    redo,
    getElements: () => list.map(e => ({ ...e })),
    isMosaicLocked: () => locked,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    toJSON: (imageSize) => ({
      v: 1,
      imageSize: { width: imageSize.width, height: imageSize.height },
      elements: list.map(e => ({ ...e }))
    })
  }
}

function fromJSON(doc) {
  const elements = Array.isArray(doc && doc.elements) ? doc.elements : []
  const locked = elements.some(e => e.kind === 'mosaic' && e.flattened)
  return createStore({ elements, mosaicLocked: locked })
}

module.exports = { createStore, fromJSON }

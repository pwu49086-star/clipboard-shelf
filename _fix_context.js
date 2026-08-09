const fs = require('fs')
const path = 'src/renderer/components/ItemRow.jsx'
let c = fs.readFileSync(path, 'utf-8')

// 修复1: handleContextMenu 不要在菜单已打开时重新设置位置
c = c.replace(
  `const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])`,
  `const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    // 如果菜单已打开，不要重新设置（防止闪烁）
    if (!contextMenu) {
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
  }, [contextMenu])`
)

// 修复2: overlay 也需要 stopPropagation，防止事件冒泡到 item-row
c = c.replace(
  `<div style={{position:'fixed',inset:0,zIndex:99}} onClick={closeContextMenu} />`,
  `<div style={{position:'fixed',inset:0,zIndex:99}} onClick={(e) => { e.stopPropagation(); closeContextMenu() }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); closeContextMenu() }} />`
)

// 修复3: 菜单项的 onClick 也要 stopPropagation
c = c.replace(
  `onClick={() => { closeContextMenu(); onCopy(item) }}`,
  `onClick={(e) => { e.stopPropagation(); closeContextMenu(); onCopy(item) }}`
)
c = c.replace(
  `onClick={() => { closeContextMenu(); onToggleFavorite(item.id) }}`,
  `onClick={(e) => { e.stopPropagation(); closeContextMenu(); onToggleFavorite(item.id) }}`
)
c = c.replace(
  `onClick={() => { closeContextMenu(); onEdit(item) }}`,
  `onClick={(e) => { e.stopPropagation(); closeContextMenu(); onEdit(item) }}`
)
c = c.replace(
  `onClick={() => { closeContextMenu(); window.api.showInExplorer(item.filePath) }}`,
  `onClick={(e) => { e.stopPropagation(); closeContextMenu(); window.api.showInExplorer(item.filePath) }}`
)
c = c.replace(
  `onClick={() => { closeContextMenu(); handlePin() }}`,
  `onClick={(e) => { e.stopPropagation(); closeContextMenu(); handlePin() }}`
)
c = c.replace(
  `onClick={() => { closeContextMenu(); onDelete(item.id) }}`,
  `onClick={(e) => { e.stopPropagation(); closeContextMenu(); onDelete(item.id) }}`
)

fs.writeFileSync(path, c)
console.log('Done')

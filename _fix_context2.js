const fs = require('fs')
const path = 'src/renderer/components/ItemRow.jsx'
let c = fs.readFileSync(path, 'utf-8')

// 1. 添加 createPortal import
c = c.replace(
  "import { memo, useCallback, useState, useRef, useEffect } from 'react'",
  "import { memo, useCallback, useState, useRef, useEffect, createPortal } from 'react'"
)

// 2. 修复 handleContextMenu - 不依赖 contextMenu
c = c.replace(
  `const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    // 如果菜单已打开，不要重新设置（防止闪烁）
    if (!contextMenu) {
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
  }, [contextMenu])`,
  `const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])`
)

// 3. 用 createPortal 渲染到 document.body
// 找到 contextMenu JSX 的开始和结束
const ctxStart = c.indexOf('{contextMenu && (')
const ctxEnd = c.indexOf('      )}\n    </div>\n  )\n})')

if (ctxStart >= 0 && ctxEnd >= 0) {
  const before = c.substring(0, ctxStart)
  const after = c.substring(ctxEnd)
  
  const newCtx = `createPortal(
        <>
          <div style={{position:'fixed',inset:0,zIndex:99}} onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }} />
          <div className="context-menu" style={{left:contextMenu.x,top:contextMenu.y}}>
            <div className="ctx-item" onClick={(e) => { closeContextMenu(); onCopy(item) }}>
              <Copy size={14} /> 复制
            </div>
            <div className="ctx-item" onClick={(e) => { closeContextMenu(); onToggleFavorite(item.id) }}>
              <Star size={14} fill={item.isFavorite ? 'currentColor' : 'none'} /> {item.isFavorite ? '取消收藏' : '收藏'}
            </div>
            {isImage && item.filePath && (
              <div className="ctx-item" onClick={(e) => { closeContextMenu(); onEdit(item) }}>
                <Pencil size={14} /> 编辑图片
              </div>
            )}
            {item.filePath && (
              <div className="ctx-item" onClick={(e) => { closeContextMenu(); window.api.showInExplorer(item.filePath) }}>
                <FolderOpen size={14} /> 打开文件位置
              </div>
            )}
            {isImage && item.filePath && (
              <div className="ctx-item" onClick={(e) => { closeContextMenu(); handlePin() }}>
                <Pin size={14} /> 钉到桌面
              </div>
            )}
            <div className="ctx-sep" />
            <div className="ctx-item ctx-danger" onClick={(e) => { closeContextMenu(); onDelete(item.id) }}>
              <Trash2 size={14} /> 删除
            </div>
          </div>
        </>,
        document.body
      )`
  
  c = before + newCtx + after
}

fs.writeFileSync(path, c)
console.log('Done')

const fs = require('fs')
const path = 'src/renderer/components/ItemRow.jsx'
let c = fs.readFileSync(path, 'utf-8')

// 1. 移除 createPortal import
c = c.replace(
  "import { memo, useCallback, useState, useRef, useEffect, createPortal } from 'react'",
  "import { memo, useCallback, useState, useRef, useEffect } from 'react'"
)

// 2. 移除 FolderOpen, Pencil import
c = c.replace(
  "import { FileText, Image, Copy, Star, Trash2, AlertTriangle, ClipboardCopy, Pin, FolderOpen, Pencil } from 'lucide-react'",
  "import { FileText, Image, Copy, Star, Trash2, AlertTriangle, ClipboardCopy, Pin } from 'lucide-react'"
)

// 3. 移除 contextMenu state
c = c.replace(
  "const [copyFlash, setCopyFlash] = useState(false)\n  const [contextMenu, setContextMenu] = useState(null)",
  "const [copyFlash, setCopyFlash] = useState(false)"
)

// 4. 移除 handleContextMenu 和 closeContextMenu
c = c.replace(
  `const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])`,
  ""
)

// 5. 移除 onContextMenu
c = c.replace(
  "onClick={handleRowClick}\n      onContextMenu={handleContextMenu}\n      onDoubleClick=",
  "onClick={handleRowClick}\n      onDoubleClick="
)

// 6. 移除整个 contextMenu JSX（createPortal 部分）
const ctxStart = c.indexOf('{contextMenu && createPortal(')
const ctxEnd = c.indexOf(')}', c.indexOf('document.body', ctxStart)) + 2

if (ctxStart >= 0 && ctxEnd >= 0) {
  c = c.substring(0, ctxStart) + c.substring(ctxEnd)
}

// 清理多余空行
c = c.replace(/\n{3,}/g, '\n\n')

fs.writeFileSync(path, c)
console.log('Done')

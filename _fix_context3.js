const fs = require('fs')
const path = 'src/renderer/components/ItemRow.jsx'
let c = fs.readFileSync(path, 'utf-8')

// 修复：createPortal 需要在 {contextMenu && ...} 条件内
c = c.replace(
  `      createPortal(
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
      )      )}`,
  `      {contextMenu && createPortal(
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
      )}`
)

fs.writeFileSync(path, c)
console.log('Done')

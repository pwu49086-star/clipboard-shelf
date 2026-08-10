import { useRef, useEffect, useCallback } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Clipboard, SearchX } from 'lucide-react'
import ItemRow from './ItemRow'

export default function ItemList({ items, selectedId, selectedIds, multiMode, onSelect, onCopy, onDelete, onToggleFavorite, onEdit, onEditContent, onOpenEdit, loading, searchQuery, onEntityClick, emptyHint = '剪贴板为空' }) {
  const virtuosoRef = useRef(null)

  // 选中项滚动到可见区域
  useEffect(() => {
    if (selectedId === null || !virtuosoRef.current) return
    const idx = items.findIndex(i => i.id === selectedId)
    if (idx >= 0) {
      virtuosoRef.current.scrollIntoView({
        index: idx,
        behavior: 'smooth'
      })
    }
  }, [selectedId, items])

  // 稳定的回调工厂，避免每次渲染创建新闭包
  const renderRow = useCallback((index, item) => (
    <ItemRow
      item={item}
      isSelected={selectedIds?.has(item.id) || item.id === selectedId}
      multiMode={multiMode}
      onSelect={onSelect}
      onCopy={onCopy}
      onDelete={onDelete}
      onToggleFavorite={onToggleFavorite}
      onEdit={onEdit}
      onEditContent={onEditContent}
      onOpenEdit={onOpenEdit}
      searchQuery={searchQuery}
      onEntityClick={onEntityClick}
    />
  ), [selectedId, selectedIds, multiMode, onSelect, onCopy, onDelete, onToggleFavorite, onEdit, onEditContent, onOpenEdit, searchQuery, onEntityClick])

  if (loading) {
    return (
      <div className="item-list-empty">
        <div className="empty-icon" style={{animation:'pulse 1.5s ease-in-out infinite'}}>📋</div>
        <span>加载中…</span>
      </div>
    )
  }

  if (items.length === 0) {
    if (searchQuery) {
      return (
        <div className="item-list-empty">
          <SearchX size={36} strokeWidth={1.5} style={{color:'var(--color-text-muted)',marginBottom:8}} />
          <span style={{fontWeight:500}}>没有找到内容</span>
          <span style={{fontSize:12,color:'var(--color-text-muted)',marginTop:4}}>试试其他关键词</span>
        </div>
      )
    }
    return (
      <div className="item-list-empty">
        <Clipboard size={36} strokeWidth={1.5} style={{color:'var(--color-text-muted)',marginBottom:8}} />
        <span style={{fontWeight:500}}>{emptyHint}</span>
        {emptyHint === '剪贴板为空' && <span style={{fontSize:12,color:'var(--color-text-muted)',marginTop:4}}>复制一些文字或截图试试～</span>}
      </div>
    )
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      className="item-list"
      data={items}
      itemContent={renderRow}
      computeItemKey={(index, item) => item.id}
      overscan={8}
    />
  )
}

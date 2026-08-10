import { forwardRef } from 'react'
import { Search, X } from 'lucide-react'
import queryUtils from '../../shared/entity-query.cjs'

const { filterLabel } = queryUtils

const SearchBar = forwardRef(({ value, onChange, count, entityFilters, onRemoveFilter }, ref) => {
  return (
    <div className="search-bar">
      <div className="search-input-wrapper">
        <Search size={16} className="search-icon" />
        <input
          ref={ref}
          type="text"
          className="search-input"
          placeholder="搜索剪贴板… 支持 品牌:大金 / 型号:RXYQ16AYM / 故障:U4 / 制冷剂:R410A"
          value={value}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {!value && <span className="search-hint">Ctrl+F</span>}
        {value && (
          <>
            <span className="search-count">{count}</span>
            <button className="search-clear" onClick={() => onChange('')} title="清除">
              <X size={14} />
            </button>
          </>
        )}
      </div>
      {entityFilters && entityFilters.length > 0 && (
        <div className="search-filter-chips">
          {entityFilters.map((f, i) => (
            <span key={i} className="search-filter-chip">
              {filterLabel(f)}:{f.value}
              <button
                className="search-filter-chip-remove"
                onClick={() => onRemoveFilter && onRemoveFilter(f)}
                title="移除该过滤条件"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
})

SearchBar.displayName = 'SearchBar'

export default SearchBar

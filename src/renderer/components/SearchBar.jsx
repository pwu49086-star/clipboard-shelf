import { forwardRef } from 'react'
import { Search, X } from 'lucide-react'

const SearchBar = forwardRef(({ value, onChange, count }, ref) => {
  return (
    <div className="search-bar">
      <div className="search-input-wrapper">
        <Search size={16} className="search-icon" />
        <input
          ref={ref}
          type="text"
          className="search-input"
          placeholder="搜索剪贴板…"
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
    </div>
  )
})

SearchBar.displayName = 'SearchBar'

export default SearchBar

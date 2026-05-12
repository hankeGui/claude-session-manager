import { useRef, useEffect } from 'react';
import { useStore, SortField, SortOrder, EmptyFilter } from '../store';

export default function SearchBar() {
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const searchMode = useStore((s) => s.searchMode);
  const setSearchMode = useStore((s) => s.setSearchMode);
  const doSearch = useStore((s) => s.doSearch);
  const sortField = useStore((s) => s.sortField);
  const sortOrder = useStore((s) => s.sortOrder);
  const emptyFilter = useStore((s) => s.emptyFilter);
  const setSortField = useStore((s) => s.setSortField);
  const setSortOrder = useStore((s) => s.setSortOrder);
  const setEmptyFilter = useStore((s) => s.setEmptyFilter);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      doSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [searchQuery, searchMode, doSearch]);

  return (
    <div className="flex gap-3 px-6 py-3 bg-bg-secondary border-b border-border">
      <div className="flex-1 flex items-center gap-0 border border-border rounded-md bg-bg-primary overflow-hidden focus-within:border-accent">
        <input
          type="text"
          placeholder={searchMode === 'regex' ? 'Regex search...' : 'Search sessions (fuzzy)...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-3.5 py-2 bg-transparent text-text-primary text-sm focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setSearchMode(searchMode === 'regex' ? 'default' : 'regex')}
          className={`px-2.5 py-1.5 mr-1 text-xs font-mono rounded transition-colors ${
            searchMode === 'regex'
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary'
          }`}
          title="Toggle regex mode"
        >
          .*
        </button>
      </div>
      <select
        value={sortField}
        onChange={(e) => setSortField(e.target.value as SortField)}
        className="px-3 py-2 border border-border rounded-md bg-bg-primary text-text-primary text-xs cursor-pointer"
      >
        <option value="modified">Modified</option>
        <option value="created">Created</option>
        <option value="messageCount">Messages</option>
        <option value="diskSize">Size</option>
      </select>
      <select
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value as SortOrder)}
        className="px-3 py-2 border border-border rounded-md bg-bg-primary text-text-primary text-xs cursor-pointer"
      >
        <option value="desc">Desc</option>
        <option value="asc">Asc</option>
      </select>
      <select
        value={emptyFilter}
        onChange={(e) => setEmptyFilter(e.target.value as EmptyFilter)}
        className="px-3 py-2 border border-border rounded-md bg-bg-primary text-text-primary text-xs cursor-pointer"
      >
        <option value="">All</option>
        <option value="true">Empty</option>
        <option value="false">Non-empty</option>
      </select>
    </div>
  );
}

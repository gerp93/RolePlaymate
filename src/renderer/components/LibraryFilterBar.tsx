import { LIBRARY_SORT_OPTIONS, LibrarySort } from '../utils/librarySort';

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  sort: LibrarySort;
  onSortChange: (value: LibrarySort) => void;
  placeholder?: string;
  /** Extra controls (e.g. a page-specific toggle) rendered after the sort dropdown. */
  after?: React.ReactNode;
}

/** Search-by-name + sort controls shared by the Characters/Personas/World Books grids. */
export default function LibraryFilterBar({ search, onSearchChange, sort, onSortChange, placeholder, after }: Props) {
  return (
    <div className="library-filter-bar">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={placeholder ?? 'Search by name…'}
        className="library-search-input"
      />
      <select value={sort} onChange={(e) => onSortChange(e.target.value as LibrarySort)}>
        {LIBRARY_SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {after}
    </div>
  );
}

// Shared by the Characters/Personas/World Books grids -- one search+sort behavior for all
// three "a bunch of cards you open one of" pages, rather than three slightly different ones.
export type LibrarySort = 'name-asc' | 'name-desc' | 'created-newest' | 'created-oldest';

export const LIBRARY_SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'created-newest', label: 'Newest first' },
  { value: 'created-oldest', label: 'Oldest first' },
];

/** ISO 8601 timestamps sort lexically in chronological order, so createdAt needs no parsing. */
export function filterAndSortLibrary<T extends { createdAt: string }>(
  items: T[],
  search: string,
  sort: LibrarySort,
  nameOf: (item: T) => string
): T[] {
  const query = search.trim().toLowerCase();
  const filtered = query ? items.filter((item) => nameOf(item).toLowerCase().includes(query)) : items;

  const sorted = [...filtered];
  switch (sort) {
    case 'name-asc':
      sorted.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      break;
    case 'name-desc':
      sorted.sort((a, b) => nameOf(b).localeCompare(nameOf(a)));
      break;
    case 'created-newest':
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case 'created-oldest':
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
  }
  return sorted;
}

export interface ParsedLorebookEntryJsonImport {
  title: string;
  keys: string;
  content: string;
  alwaysOn: boolean;
  priority: number;
  enabled: boolean;
}

export interface ParsedLorebookJsonImport {
  /** null when the JSON had no (or a blank) "name" -- only meaningful to a caller creating a
   * brand-new world book; adding entries to an existing book ignores this entirely. */
  name: string | null;
  description: string | null;
  entries: ParsedLorebookEntryJsonImport[];
  warnings: string[];
}

/**
 * Parses the bulk-import JSON shape (see shared/lorebookImportSample.ts). Unlike the HTML
 * importers, a structurally invalid file (bad JSON, no "entries" array) throws rather than
 * limping through -- there's no partial page to salvage text from, just a document the user
 * wrote by hand. Once past that, an individual bad entry is skipped with a warning rather than
 * failing the whole import, matching parseCharacterHtml/parseLorebookHtml's approach.
 */
export function parseLorebookJson(raw: string): ParsedLorebookJsonImport {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Not valid JSON: ${(err as Error).message}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Expected a JSON object with an "entries" array.');
  }
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.entries)) {
    throw new Error('Expected an "entries" array.');
  }

  const warnings: string[] = [];
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : null;
  const description =
    typeof obj.description === 'string' && obj.description.trim() ? obj.description.trim() : null;

  const entries: ParsedLorebookEntryJsonImport[] = [];
  obj.entries.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      warnings.push(`Entry ${i + 1}: not an object -- skipped.`);
      return;
    }
    const e = raw as Record<string, unknown>;
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    if (!title) {
      warnings.push(`Entry ${i + 1}: missing "title" -- skipped.`);
      return;
    }
    entries.push({
      title,
      keys: typeof e.keys === 'string' ? e.keys : '',
      content: typeof e.content === 'string' ? e.content : '',
      alwaysOn: e.alwaysOn === true,
      priority: typeof e.priority === 'number' && Number.isFinite(e.priority) ? e.priority : 0,
      enabled: e.enabled !== false,
    });
  });

  if (entries.length === 0) {
    warnings.push('No valid entries found.');
  }

  return { name, description, entries, warnings };
}

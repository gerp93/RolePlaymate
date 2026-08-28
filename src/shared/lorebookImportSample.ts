/**
 * The JSON shape `lorebooks:importFromJson` / `loreEntries:importFromJson` expect, and what
 * the "Copy sample JSON" buttons put on the clipboard. One shared source so the samples shown
 * to the user and the parser's expectations (see main/lorebookJsonImport.ts) can't drift apart.
 */
export const SAMPLE_LOREBOOK_ENTRY = {
  title: 'Entry title',
  keys: 'keyword one, keyword two',
  content: 'The text injected into the prompt when one of the keys above fires.',
  alwaysOn: false,
  priority: 0,
  enabled: true,
};

/** Creates a brand-new world book -- name/description are used. */
export const WORLD_BOOK_IMPORT_SAMPLE = {
  name: 'Sample World Book',
  description: 'A short description of this book.',
  entries: [SAMPLE_LOREBOOK_ENTRY],
};

/** Adds entries to an already-existing personal history -- name/description would be ignored,
 * so the sample omits them rather than imply they'd do something. */
export const LOREBOOK_ENTRIES_IMPORT_SAMPLE = {
  entries: [SAMPLE_LOREBOOK_ENTRY],
};

import { diffWords } from 'diff';

export type DiffPartType = 'added' | 'removed' | 'unchanged';

export interface DiffPart {
  type: DiffPartType;
  text: string;
}

/** Word-level diff between two field versions' content. Pure and framework-agnostic --
 * runs entirely client-side since both versions' content are already loaded in the editor. */
export function diffVersionContent(fromText: string, toText: string): DiffPart[] {
  const chunks = diffWords(fromText, toText);

  return chunks.map((chunk) => ({
    type: chunk.added ? 'added' : chunk.removed ? 'removed' : 'unchanged',
    text: chunk.value,
  }));
}

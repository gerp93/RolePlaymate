/**
 * Guarantees the *italic thought* / **bold everything-else** convention the character
 * instructions ask for (see promptTemplates.ts), even on the turns a model doesn't fully comply
 * with. Bold has no effect on TTS routing -- only italics does, see ttsSegments.ts -- so this is
 * a cosmetic backstop, not something load-bearing elsewhere: any plain-text run left over after
 * accounting for existing italic, bold, and {{macro}} markup gets wrapped in double asterisks.
 *
 * Mirrors FormattedContent.tsx's INLINE_TOKEN tokenizer so the two stay in agreement about what
 * counts as an existing marker.
 */
const INLINE_TOKEN = /(\*\*.+?\*\*|\*.+?\*|\{\{.+?\}\})/g;

/** A list line's "- " marker is left alone -- swallowing it into a bold span would break
 * FormattedContent's `isListBlock` detection on render. */
const LIST_MARKER = /^(\s*-\s+)/;

function normalizeLine(line: string): string {
  const listMarker = LIST_MARKER.exec(line);
  const prefix = listMarker ? listMarker[1] : '';
  const rest = listMarker ? line.slice(prefix.length) : line;

  const wrapped = rest
    .split(INLINE_TOKEN)
    .map((chunk) => {
      if (!chunk) return chunk;
      if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length >= 4) return chunk;
      if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length >= 2) return chunk;
      if (chunk.startsWith('{{') && chunk.endsWith('}}')) return chunk;
      if (!/\S/.test(chunk)) return chunk;

      const leading = /^\s*/.exec(chunk)![0];
      const trailing = /\s*$/.exec(chunk)![0];
      const core = chunk.slice(leading.length, chunk.length - trailing.length);
      return `${leading}**${core}**${trailing}`;
    })
    .join('');

  return prefix + wrapped;
}

/** Applied once to a finished assistant reply, before it's persisted -- see the four
 * `result.content.trim()` call sites in chatSession.ts. Not applied to user-authored text. */
export function normalizeReplyFormatting(text: string): string {
  return text.split('\n').map(normalizeLine).join('\n');
}

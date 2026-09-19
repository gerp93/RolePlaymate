/**
 * Repairs and enforces the reply convention: italic for actions/thoughts/narration, bold for
 * quoted speech. Bold has no effect on TTS routing (only italics does, see ttsSegments.ts), so
 * this is mostly about the transcript looking right and staying consistent for the model, which
 * imitates whatever formatting is already in its history.
 *
 * Models routinely open a bold span and never close it. The old wrap-the-unmarked-runs approach
 * turned that into a run of doubled asterisks, so this parses markers tolerantly instead: each
 * line is flattened into styled segments (an unclosed marker just runs to the end of the line)
 * and re-emitted in canonical form -- only ever plain italic or bold, never both at once, which
 * is all FormattedContent's renderer and the TTS splitter understand.
 */
interface Segment {
  text: string;
  bold: boolean;
  italic: boolean;
}

const LIST_MARKER = /^(\s*-\s+)/;
const HAS_WORD = /[\p{L}\p{N}]/u;
const QUOTE_CHARS = /["“”]/;
/** An opening quote, its contents, and the closing quote (or the end of the line if unclosed). */
const QUOTED_SPAN = /["“][^"“”]*["”]?/g;

function parseSegments(line: string): Segment[] {
  const segments: Segment[] = [];
  let bold = false;
  let italic = false;
  let buffer = '';

  const flush = () => {
    if (buffer) segments.push({ text: buffer, bold, italic });
    buffer = '';
  };

  for (let i = 0; i < line.length; ) {
    if (line[i] === '*') {
      flush();
      if (line[i + 1] === '*') {
        bold = !bold;
        i += 2;
      } else {
        italic = !italic;
        i += 1;
      }
      continue;
    }
    buffer += line[i];
    i += 1;
  }
  flush();
  return segments;
}

/** Surrounding whitespace stays outside the markers so spacing between runs is untouched. */
function wrap(text: string, marker: '*' | '**'): string {
  if (!HAS_WORD.test(text)) return text;
  const leading = /^\s*/.exec(text)![0];
  const trailing = /\s*$/.exec(text)![0];
  const core = text.slice(leading.length, text.length - trailing.length);
  return `${leading}${marker}${core}${marker}${trailing}`;
}

function normalizeLine(line: string, replyHasQuotes: boolean): string {
  const listMarker = LIST_MARKER.exec(line);
  const prefix = listMarker ? listMarker[1] : '';
  const rest = listMarker ? line.slice(prefix.length) : line;

  const out = parseSegments(rest).map((segment): string => {
    if (!replyHasQuotes) {
      // No quotation marks anywhere in the reply, so nothing says what is speech: keep whatever
      // the model marked and treat unmarked text as spoken.
      if (segment.bold) return wrap(segment.text, '**');
      if (segment.italic) return wrap(segment.text, '*');
      return wrap(segment.text, '**');
    }

    if (segment.italic && !segment.bold) return wrap(segment.text, '*');
    if (segment.bold) {
      // Bold without a quotation mark is a bolded action (the model over-applying the rule),
      // not speech.
      return QUOTE_CHARS.test(segment.text) ? wrap(segment.text, '**') : wrap(segment.text, '*');
    }

    // Unmarked: quoted spans are speech, whatever sits between them is narration.
    let result = '';
    let last = 0;
    for (const match of segment.text.matchAll(QUOTED_SPAN)) {
      const start = match.index ?? 0;
      result += wrap(segment.text.slice(last, start), '*');
      result += wrap(match[0], '**');
      last = start + match[0].length;
    }
    return result + wrap(segment.text.slice(last), '*');
  });

  return prefix + out.join('');
}

/** Applied once to a finished assistant reply, before it's persisted. Not applied to
 * user-authored text. */
export function normalizeReplyFormatting(text: string): string {
  const replyHasQuotes = QUOTE_CHARS.test(text);
  return text
    .split('\n')
    .map((line) => normalizeLine(line, replyHasQuotes))
    .join('\n');
}

/** A sentence terminator plus any closing quotes, asterisks, or brackets hugging it. */
const SENTENCE_END = /[.!?…]+["'”’)\]*]*/g;

/** Drops a trailing unfinished sentence. Returns the text unchanged when it has no complete
 * sentence to fall back to. */
export function trimToLastSentence(text: string): string {
  let end = -1;
  for (const match of text.matchAll(SENTENCE_END)) {
    end = (match.index ?? 0) + match[0].length;
  }
  return end > 0 ? text.slice(0, end).trimEnd() : text;
}

/** Concise mode hard-caps generation at this many tokens (~85 words). Wording alone doesn't
 * hold a local model to a short reply -- it copies the length of the replies already in the
 * history -- so the cap is what actually guarantees it. */
export const CONCISE_MAX_TOKENS = 120;

/**
 * The finished-reply pipeline: when concise mode cut generation off at the cap, fall back to the
 * last complete sentence (so it never ends mid-word), then repair/normalize the markup.
 */
export function finalizeReply(
  raw: string,
  opts: { concise: boolean; evalCount: number | null; numPredict: number | undefined }
): string {
  let text = raw.trim();
  const hitCap =
    opts.concise &&
    opts.evalCount !== null &&
    opts.numPredict !== undefined &&
    opts.evalCount >= opts.numPredict;
  if (hitCap) {
    text = trimToLastSentence(text);
    // The cut can land inside a line of dialogue; close that quote so the bold span ends cleanly.
    if ((text.match(/"/g) ?? []).length % 2 === 1) text += '"';
  }
  return normalizeReplyFormatting(text);
}

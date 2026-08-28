import * as fs from 'fs';
import * as path from 'path';
import { HTMLElement, Node as ParsedNode, NodeType, parse } from 'node-html-parser';
import { FIELD_TYPES, FieldType } from '../shared/types/characterField';

export interface ParsedCharacterImport {
  name: string;
  description: string | null;
  /** Only the field types actually found on the page -- callers should leave the rest blank. */
  fields: Partial<Record<FieldType, string>>;
  /** The page's "Scenario" section, if found. Kept separate from `fields` since scenario is no
   * longer a fixed CharacterField -- callers create a Scenario from this instead (see
   * characters:importFromHtml). */
  scenario: string | null;
  /** The page's "Greeting" section. Same treatment as `scenario` -- greeting is scenario-
   * specific now too, so this becomes that same Scenario's greeting rather than a
   * CharacterField. */
  greeting: string | null;
  /** The profile image's `src` as written in the page -- usually a path relative to the saved
   * HTML file's own "_files" folder. Resolve with resolveLocalAvatarPath before using it. */
  avatarSrc: string | null;
  /** Human-readable notes on anything expected but not found, surfaced to the user as-is. */
  warnings: string[];
}

/** The section labels this importer recognizes -- the fixed CharacterFields plus "scenario" and
 * "greeting", which are extracted the same way but handled separately (see
 * ParsedCharacterImport.scenario/greeting). */
type ImportSection = FieldType | 'scenario' | 'greeting';

// A saved chatbot profile page labels each section with a standalone heading element
// ("Greeting", "Personality", ...) immediately followed by a container holding that
// section's content -- this holds regardless of the exact class names the source site ships,
// which is what makes matching on label text (rather than CSS classes) durable.
const SECTION_LABELS: Record<string, ImportSection> = {
  greeting: 'greeting',
  personality: 'personality',
  scenario: 'scenario',
  'example dialogues': 'dialogue',
  'example dialogue': 'dialogue',
};

/** Parses a saved chatbot-profile HTML page into character fields. Missing sections are simply
 * omitted from `fields`/`avatarSrc` and noted in `warnings` -- nothing throws just because a
 * section wasn't on the page. */
export function parseCharacterHtml(html: string): ParsedCharacterImport {
  const root = parse(html, { comment: false });
  const warnings: string[] = [];

  const identity = extractIdentity(root);
  const fallback = fallbackName(root);
  const name = identity.name?.trim() || fallback.name;
  if (!identity.name?.trim() && !fallback.confident) {
    warnings.push(`Could not find a character name -- using "${name}". Rename it after importing.`);
  }

  const description = identity.description?.trim() || null;
  if (!description) {
    warnings.push('No description found.');
  }

  const extracted = extractFields(root);
  const scenario = extracted.scenario ?? null;
  const greeting = extracted.greeting ?? null;
  const fields: Partial<Record<FieldType, string>> = {};
  for (const fieldType of FIELD_TYPES) {
    if (extracted[fieldType] !== undefined) fields[fieldType] = extracted[fieldType];
  }

  const missingTypes = new Set<FieldType>(FIELD_TYPES);
  for (const fieldType of Object.keys(fields) as FieldType[]) missingTypes.delete(fieldType);
  for (const fieldType of missingTypes) {
    warnings.push(`No "${fieldType}" section found on the page -- left blank.`);
  }
  if (!scenario) {
    warnings.push('No "scenario" section found on the page -- left blank.');
  }
  if (!greeting) {
    warnings.push('No "greeting" section found on the page -- left blank.');
  }

  // Prefer the visible profile image's src: it's normally a path into the "_files" folder
  // saved alongside the HTML, which is the only kind of image source this (offline, local-only)
  // import can actually resolve. The JSON-LD image is nearly always a remote CDN URL, so it's
  // only useful as a last-resort fallback (still reported as unresolvable, since there's no
  // local file for it, but at least the right thing was attempted).
  const avatarSrc = root.querySelector('img[alt="avatar image"]')?.getAttribute('src') || identity.image || null;
  if (!avatarSrc) {
    warnings.push('No portrait image found.');
  }

  return { name, description, fields, scenario, greeting, avatarSrc, warnings };
}

/** `confident: true` means a genuine name-shaped source was found (page heading or browser-tab
 * title); `false` means we're using a generic placeholder as a last resort. */
function fallbackName(root: HTMLElement): { name: string; confident: boolean } {
  const h1 = root.querySelector('h1')?.text.trim();
  if (h1) return { name: h1, confident: true };
  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
  if (ogTitle) return { name: ogTitle.split(/\s+-\s+/)[0].trim() || ogTitle, confident: true };
  return { name: 'Imported Character', confident: false };
}

interface Identity {
  name?: string;
  description?: string;
  image?: string;
}

/** Prefers the page's JSON-LD structured data (a stable, purpose-built summary of the
 * character) over scraping the visible layout; falls back to Open Graph meta tags. */
function extractIdentity(root: HTMLElement): Identity {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.text);
      const nodes: unknown[] = Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
      const person = nodes.find(
        (n): n is Record<string, unknown> => !!n && typeof n === 'object' && (n as any)['@type'] === 'Person'
      );
      if (person) {
        const image = person.image;
        return {
          name: typeof person.name === 'string' ? person.name : undefined,
          description: typeof person.description === 'string' ? person.description : undefined,
          image:
            typeof image === 'string'
              ? image
              : image && typeof image === 'object' && typeof (image as any).url === 'string'
                ? (image as any).url
                : undefined,
        };
      }
    } catch {
      // Malformed JSON-LD -- try the next script tag, or fall through to meta tags below.
    }
  }

  return {
    name: root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.split(/\s+-\s+/)[0],
    description: root.querySelector('meta[property="og:description"]')?.getAttribute('content'),
    image: root.querySelector('meta[property="og:image"]')?.getAttribute('content'),
  };
}

/** Finds every standalone label element ("Greeting", "Personality", ...) and converts the
 * content container immediately after it into formatted plain text. */
function extractFields(root: HTMLElement): Partial<Record<ImportSection, string>> {
  const fields: Partial<Record<ImportSection, string>> = {};

  for (const el of root.querySelectorAll('*')) {
    if (el.children.length > 0) continue; // only leaf (text-only) elements can be section labels
    const fieldType = SECTION_LABELS[el.text.trim().toLowerCase()];
    if (!fieldType || fields[fieldType] !== undefined) continue;

    const contentContainer = el.nextElementSibling;
    if (!contentContainer) continue;

    const text = contentContainerToText(contentContainer);
    if (text) fields[fieldType] = text;
  }

  return fields;
}

/** The content container generally wraps its text in a single rich-text element alongside a
 * "SHOW LESS" toggle button -- skip the button and convert whatever text element remains. */
function contentContainerToText(container: HTMLElement): string {
  const contentRoot = container.children.find((c) => c.tagName?.toLowerCase() !== 'button') ?? container;

  // Consecutive inline content (bare text, <em>, <strong>, ...) accumulates into one running
  // paragraph; only an actual block-level element (a list, or something marked as its own
  // "block") starts a new one. Without this, loose text sitting directly next to an inline
  // element -- e.g. "Just a <em>simple</em> personality." with no wrapping <span> -- would get
  // needlessly split into three separate blank-line-separated paragraphs.
  const blocks: string[] = [];
  let paragraph = '';

  const flushParagraph = () => {
    const text = paragraph
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();
    if (text) blocks.push(text);
    paragraph = '';
  };

  for (const child of contentRoot.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      paragraph += child.text.replace(/\s+/g, ' ');
      continue;
    }
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;

    const el = child as HTMLElement;
    if (isBlockElement(el)) {
      flushParagraph();
      const text = blockToText(el);
      if (text) blocks.push(text);
    } else {
      paragraph += inlineToText(el);
    }
  }
  flushParagraph();

  return blocks.join('\n\n').trim();
}

function isBlockElement(el: HTMLElement): boolean {
  const tag = el.tagName?.toLowerCase();
  if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'p' || (tag && /^h[1-6]$/.test(tag))) return true;
  return el.classList.contains('block');
}

/** Converts one top-level block (a paragraph-like element, or a list) to plain text. Lists
 * become "- " bulleted lines; everything else becomes a single (possibly multi-line) paragraph
 * via inlineToText. */
function blockToText(el: HTMLElement): string {
  const tag = el.tagName?.toLowerCase();
  if (tag === 'ul' || tag === 'ol') {
    return el.children
      .filter((c) => c.tagName?.toLowerCase() === 'li')
      .map((li) => `- ${collapseWhitespace(inlineToText(li))}`)
      .join('\n')
      .trim();
  }
  return inlineToText(el)
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** Converts inline markup to a plain-text approximation, since field content is stored and
 * edited as plain text: <em>/<i> become *asterisks*, <strong>/<b> become **double asterisks**,
 * <quote>/<q> become "double quotes", <br> becomes a newline, everything else is unwrapped. */
function inlineToText(node: ParsedNode): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return node.text.replace(/\s+/g, ' ');
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'br') return '\n';

  const inner = el.childNodes.map(inlineToText).join('');
  if (tag === 'em' || tag === 'i') return `*${inner.trim()}*`;
  if (tag === 'strong' || tag === 'b') return `**${inner.trim()}**`;
  if (tag === 'quote' || tag === 'q') return `"${inner.trim()}"`;
  return inner;
}

function collapseWhitespace(text: string): string {
  return text.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Resolves a page-relative avatar `src` against the saved HTML file's own directory (where
 * "Save Page As... > Webpage, Complete" leaves a "_files" folder of cached assets). Returns
 * null for anything that isn't a local file that actually exists -- remote URLs are left alone
 * since this app doesn't make network calls. */
export function resolveLocalAvatarPath(htmlFilePath: string, avatarSrc: string | null): string | null {
  if (!avatarSrc) return null;
  if (/^(https?:)?\/\//i.test(avatarSrc) || avatarSrc.startsWith('data:')) return null;

  const dir = path.dirname(htmlFilePath);
  let decoded = avatarSrc;
  try {
    decoded = decodeURIComponent(avatarSrc);
  } catch {
    // Not URI-encoded (or invalid escapes) -- use the raw value as-is.
  }

  const candidate = path.resolve(dir, decoded);
  return fs.existsSync(candidate) ? candidate : null;
}

export interface ParsedLorebookEntryImport {
  title: string;
  /** Trigger keywords as found on the page, comma-separated -- ready to hand straight to
   * CreateLorebookEntryInput.keys. */
  keys: string;
  content: string;
  /** The source page's lorebook view only ever shows the first few keys inline (then a "+N"
   * badge for the rest) -- there's no way to recover the hidden ones from a saved copy of this
   * page, so this is >0 exactly when some were left out. */
  truncatedKeyCount: number;
}

export interface ParsedLorebookImport {
  name: string;
  description: string | null;
  /** Same convention as ParsedCharacterImport.avatarSrc -- resolve with resolveLocalAvatarPath. */
  avatarSrc: string | null;
  entries: ParsedLorebookEntryImport[];
  warnings: string[];
}

/** Parses a saved lorebook-detail page (one open lorebook and its entry list, e.g.
 * "Save Page As... > Webpage, Complete" from a lorebook's own URL -- a page listing multiple
 * lorebooks has nothing to scrape, since it's just a grid of links into pages like this one).
 * Missing pieces are omitted and noted in `warnings` rather than failing the whole import,
 * matching parseCharacterHtml's approach. */
export function parseLorebookHtml(html: string): ParsedLorebookImport {
  const root = parse(html, { comment: false });
  const warnings: string[] = [];

  const titleP = root
    .querySelectorAll('*')
    .find((el) => el.children.length === 0 && el.classList.contains('text-mobile-heading-3'));
  const name = titleP?.text.trim() || fallbackLorebookName(root);
  if (!titleP?.text.trim()) {
    warnings.push(`Could not find a lorebook name -- using "${name}". Rename it after importing.`);
  }

  // The name/creator-handle block, the description, and the tag chips are siblings two levels
  // up from the name itself. Filtering direct children by tag ('P') finds the description
  // regardless of how many of those siblings exist -- tags aren't part of this app's Lorebook
  // shape and are simply not imported.
  const infoContainer = titleP?.parentNode?.parentNode ?? null;
  const description = infoContainer?.children.find((c) => c.tagName === 'P')?.text.trim() || null;
  if (!description) {
    warnings.push('No description found.');
  }

  const avatarSrc = root.querySelector('img[alt="avatar image"]')?.getAttribute('src') || null;
  if (!avatarSrc) {
    warnings.push('No cover image found.');
  }

  const entries = extractLorebookEntries(root);
  if (entries.length === 0) {
    warnings.push('No lorebook entries found on the page.');
  }
  const truncated = entries.filter((e) => e.truncatedKeyCount > 0);
  if (truncated.length > 0) {
    warnings.push(
      `${truncated.length} ${truncated.length === 1 ? 'entry has' : 'entries have'} more trigger ` +
        `keys than this saved page shows (the source page's list view only displays the first few) -- ` +
        `open each flagged entry after importing to fill in the rest.`
    );
  }

  return { name, description, avatarSrc, entries, warnings };
}

function fallbackLorebookName(root: HTMLElement): string {
  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
  if (ogTitle) return ogTitle.split(/\s+[|–-]\s+/)[0].trim() || ogTitle;
  return 'Imported Lorebook';
}

/**
 * Each entry renders as a <button> holding exactly two `[data-tooltip-content]` wrappers -- one
 * around the title paragraph, one around the content paragraph (both also visually line-clamped,
 * but the underlying text nodes carry the full, untruncated string either way). That "exactly
 * two tooltip wrappers" shape is distinctive enough among everything else on the page (the
 * back/share/tag buttons carry none) to select entries reliably without depending on exact
 * class names, which is the same durability tradeoff extractFields above makes for label text.
 */
function extractLorebookEntries(root: HTMLElement): ParsedLorebookEntryImport[] {
  const entries: ParsedLorebookEntryImport[] = [];

  for (const button of root.querySelectorAll('button')) {
    const tooltipWrappers = button.querySelectorAll('div[data-tooltip-content]');
    if (tooltipWrappers.length !== 2) continue;

    const [titleWrapper, contentWrapper] = tooltipWrappers;
    const title = titleWrapper.querySelector('p')?.text.trim();
    const content = contentWrapper.querySelector('p')?.text.trim();
    if (!title && !content) continue;

    // The keys row is the title row's next sibling within their shared parent -- see the
    // title/keys/content div triple in the entry markup this was written against.
    const titleRow = titleWrapper.parentNode;
    const keysRow = titleRow?.parentNode?.children[1];
    const keyParagraphs = keysRow?.children.filter((c) => c.tagName === 'P') ?? [];
    const visibleKeysText = keyParagraphs[0]?.text.trim() ?? '';
    const overflowMatch = keyParagraphs[1]?.text.trim().match(/^\+(\d+)$/);

    const keys = visibleKeysText
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .join(', ');

    entries.push({
      title: title || 'Untitled entry',
      keys,
      content: content ?? '',
      truncatedKeyCount: overflowMatch ? parseInt(overflowMatch[1], 10) : 0,
    });
  }

  return entries;
}

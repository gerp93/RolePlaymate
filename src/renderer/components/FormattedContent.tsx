import { Fragment, ReactNode } from 'react';

interface Props {
  text: string;
}

// Matches this app's plain-text formatting convention (also what the HTML importer produces):
// **bold**, *italic*, and {{macro}} placeholders like {{user}}/{{char}}. Checked in this order
// so "**bold**" isn't mistaken for two "*" italics.
const INLINE_TOKEN = /(\*\*.+?\*\*|\*.+?\*|\{\{.+?\}\})/g;

function parseInline(line: string, keyPrefix: string): ReactNode[] {
  return line
    .split(INLINE_TOKEN)
    .filter((chunk) => chunk !== '')
    .map((chunk, i) => {
      const key = `${keyPrefix}-${i}`;
      if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length >= 4) {
        return <strong key={key}>{chunk.slice(2, -2)}</strong>;
      }
      if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length >= 2) {
        return <em key={key}>{chunk.slice(1, -1)}</em>;
      }
      if (chunk.startsWith('{{') && chunk.endsWith('}}')) {
        return (
          <span key={key} className="content-macro">
            {chunk}
          </span>
        );
      }
      return chunk;
    });
}

function isListBlock(block: string): boolean {
  return block.split('\n').every((line) => line.trim().startsWith('- '));
}

/** Renders this app's plain-text field content (paragraphs separated by blank lines, "- "
 * bullet lists, italic/bold/{{macro}} inline markers) as readable, formatted text -- the
 * inverse of what htmlImport.ts produces on the way in. */
export default function FormattedContent({ text }: Props) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length === 0) return null;

  return (
    <>
      {blocks.map((block, blockIndex) => {
        if (isListBlock(block)) {
          const items = block.split('\n').map((line) => line.trim().replace(/^- /, ''));
          return (
            <ul key={blockIndex} className="content-list">
              {items.map((item, itemIndex) => (
                <li key={itemIndex}>{parseInline(item, `${blockIndex}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }

        const lines = block.split('\n');
        return (
          <p key={blockIndex} className="content-paragraph">
            {lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {parseInline(line, `${blockIndex}-${lineIndex}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

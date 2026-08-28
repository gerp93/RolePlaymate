import { useState, type ReactNode } from 'react';

interface LorebookJsonImportProps {
  importing: boolean;
  onImport: () => void;
  /** The sample object shown/copied -- WORLD_BOOK_IMPORT_SAMPLE or
   * LOREBOOK_ENTRIES_IMPORT_SAMPLE from shared/lorebookImportSample. */
  sample: object;
  /** Extra action buttons rendered before the JSON import controls (e.g. create + HTML import). */
  prepend?: ReactNode;
}

/**
 * "Import from JSON…" plus the copy-sample/show-sample controls, shared by WorldBookList (new
 * book) and Personal/PersonaHistoryPanel (entries into an existing book) -- only the sample
 * shape and the import handler differ between the two.
 */
export default function LorebookJsonImport({ importing, onImport, sample, prepend }: LorebookJsonImportProps) {
  const [copied, setCopied] = useState(false);
  const sampleJson = JSON.stringify(sample, null, 2);

  const copySample = async () => {
    await navigator.clipboard.writeText(sampleJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="lorebook-json-import">
      {prepend}
      <button className="btn" disabled={importing} onClick={onImport}>
        {importing ? 'Importing…' : 'Import from JSON…'}
      </button>
      <details>
        <summary>
          Sample JSON
          <button
            type="button"
            className="lorebook-json-copy-btn"
            title={copied ? 'Copied!' : 'Copy sample JSON'}
            aria-label="Copy sample JSON"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void copySample();
            }}
          >
            {copied ? '✓' : '⧉'}
          </button>
        </summary>
        <pre className="lorebook-json-sample">
          <code>{sampleJson}</code>
        </pre>
      </details>
    </div>
  );
}

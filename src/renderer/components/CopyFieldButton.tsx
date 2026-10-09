import { useEffect, useRef, useState } from 'react';

interface Props {
  text: string;
  /** Sits inside a textarea's corner rather than an input's, so it clears the scrollbar. */
  multiline?: boolean;
}

/** Small "Copy" control for a text field: puts the field's current text on the clipboard. */
export default function CopyFieldButton({ text, multiline = false }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1500);
  };

  return (
    <button
      type="button"
      className={`limited-copy-btn${multiline ? ' limited-copy-btn-multiline' : ''}`}
      // Not part of the form's tab order or its submit: it is a convenience beside the field.
      tabIndex={-1}
      disabled={!text}
      title="Copy this field's text"
      aria-label="Copy this field's text"
      onClick={() => void copy()}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Failed' : 'Copy'}
    </button>
  );
}

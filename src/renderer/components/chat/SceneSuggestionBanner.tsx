import { useEffect, useState } from 'react';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';
import LimitedTextarea from '../LimitedTextarea';

interface Props {
  /** The proposed scene note, found after the latest reply. */
  suggestion: string;
  /** Whether the chat already has a note this would replace. */
  hasNote: boolean;
  onApply: (text: string) => void;
  onDismiss: () => void;
}

/**
 * Offered above the composer when the latest reply looks like the story moved somewhere new: the
 * proposed scene note, editable, to keep or ignore. Never blocks the chat -- ignoring it costs
 * nothing and the same suggestion is not offered again.
 */
export default function SceneSuggestionBanner({ suggestion, hasNote, onApply, onDismiss }: Props) {
  const [draft, setDraft] = useState(suggestion);
  useEffect(() => setDraft(suggestion), [suggestion]);

  return (
    <div className="scene-suggestion" role="region" aria-label="Scene change suggestion">
      <div>
        <strong>The scene may have moved on.</strong>{' '}
        <span className="text-muted">
          {hasNote ? 'Update the scene note?' : 'Set a scene note so the story stays here?'}
        </span>
      </div>
      <LimitedTextarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        limit={FIELD_LIMITS.sceneNote}
        rows={2}
        compactCount
      />
      <div className="scene-suggestion-actions">
        <button type="button" className="btn btn-primary" disabled={!draft.trim()} onClick={() => onApply(draft)}>
          {hasNote ? 'Update scene note' : 'Set scene note'}
        </button>
        <button type="button" className="btn" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

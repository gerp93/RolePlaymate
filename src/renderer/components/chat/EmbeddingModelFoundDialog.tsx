import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  model: string;
  onClose: () => void;
}

export default function EmbeddingModelFoundDialog({ model, onClose }: Props) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop embedding-model-missing-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-dialog embedding-model-found-dialog"
        role="dialog"
        aria-labelledby="embedding-model-found-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="embedding-model-found-title">Embedding model found</h2>
        <p>
          The <code>{model}</code> embedding model is installed in Ollama. Unpinned memories will now be matched by
          meaning — you&apos;re good to go.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" autoFocus onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

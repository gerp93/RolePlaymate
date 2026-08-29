import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_EMBEDDING_MODEL } from '../../../shared/embeddingModel';
import CopyableTerminalCommand from '../CopyableTerminalCommand';
import EmbeddingModelFoundDialog from './EmbeddingModelFoundDialog';
import './Chat.css';

/** User-initiated checks finish so fast locally that a short floor makes the feedback legible. */
const USER_CHECK_MIN_MS = 650;
const OLLAMA_POLL_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function isPromptSuppressed(): Promise<boolean> {
  try {
    const result = await window.electronAPI.embeddingModelPrompt.getSuppressed();
    return result.suppressed;
  } catch {
    return false;
  }
}

interface Props {
  /** Wait until Chat has confirmed Ollama is reachable before evaluating. */
  enabled: boolean;
}

/**
 * Modal shown when Chat is ready and the memory embedding model is missing.
 * Portaled to document.body so it isn't clipped by the chat layout.
 */
export default function EmbeddingModelMissingPrompt({ enabled }: Props) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(DEFAULT_EMBEDDING_MODEL);
  const [checking, setChecking] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);
  const [dontRemindAgain, setDontRemindAgain] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successModel, setSuccessModel] = useState(DEFAULT_EMBEDDING_MODEL);
  const [continueError, setContinueError] = useState<string | null>(null);
  const settledRef = useRef(false);
  const dontRemindAgainRef = useRef(false);

  const evaluate = useCallback(async (fromUser = false) => {
    if (!enabled && !fromUser) return false;

    if (fromUser) {
      setChecking(true);
      setCheckNotice(null);
    }
    try {
      const [status, suppressed] = await Promise.all([
        window.electronAPI.ollama.getEmbeddingModelStatus(),
        isPromptSuppressed(),
        fromUser ? delay(USER_CHECK_MIN_MS) : Promise.resolve(),
      ]);
      setModel(status.model);

      if (!status.ollamaReachable) {
        return false;
      }

      const stillMissing = !status.installed;
      if (fromUser && status.installed) {
        settledRef.current = true;
        setOpen(false);
        setSuccessModel(status.model);
        setSuccessOpen(true);
        return true;
      }

      if (fromUser && stillMissing) {
        setCheckNotice(
          `The ${status.model} model is not installed in Ollama yet. Run the command above, then check again.`
        );
        return true;
      }

      settledRef.current = true;
      const shouldOpen = stillMissing && !suppressed;
      if (shouldOpen) {
        dontRemindAgainRef.current = false;
        setDontRemindAgain(false);
      }
      setOpen(shouldOpen);
      return true;
    } finally {
      if (fromUser) setChecking(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      settledRef.current = false;
      setOpen(false);
      return;
    }

    settledRef.current = false;
    let cancelled = false;

    async function poll() {
      if (cancelled || settledRef.current) return;
      const done = await evaluate(false);
      if (!cancelled && !done) {
        window.setTimeout(() => void poll(), OLLAMA_POLL_MS);
      }
    }

    void poll();

    return () => {
      cancelled = true;
    };
  }, [enabled, evaluate]);

  async function continueWithoutEmbedding() {
    if (continuing) return;
    const suppress = dontRemindAgainRef.current;
    setContinuing(true);
    setContinueError(null);
    try {
      if (suppress) {
        await window.electronAPI.embeddingModelPrompt.setSuppressed(true);
        const saved = await window.electronAPI.embeddingModelPrompt.getSuppressed();
        if (!saved.suppressed) {
          throw new Error('Could not save reminder preference.');
        }
      }
      settledRef.current = true;
      setOpen(false);
    } catch {
      setContinueError('Could not save that preference. Try again, or turn it off in Settings.');
    } finally {
      setContinuing(false);
    }
  }

  const missingDialog =
    open &&
    createPortal(
      <div className="modal-backdrop embedding-model-missing-backdrop" role="presentation">
        <div
          className="modal-dialog embedding-model-missing-dialog"
          role="dialog"
          aria-labelledby="embedding-model-missing-title"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="embedding-model-missing-title">An optional embedding model is missing</h2>
          <p className="embedding-model-missing-lead">
            Chat does not require a separate embedding model, but without one the character is more
            likely to forget earlier parts of the conversation as it grows.
          </p>
          <p className="embedding-model-missing-lead">
            Unpinned memories are matched by meaning through the Ollama model <code>{model}</code>.
            Memories you pin in the Memories pane of the chat still work without it.
          </p>

          <section className="embedding-model-missing-install" aria-label="Install command">
            <p className="embedding-model-missing-label">In a terminal, run:</p>
            <CopyableTerminalCommand command={`ollama pull ${model}`} />
          </section>

          <section className="embedding-model-missing-check" aria-label="Installation status">
            <button
              type="button"
              className="btn embedding-model-missing-check-btn"
              disabled={checking}
              aria-busy={checking}
              onClick={() => void evaluate(true)}
            >
              {checking ? (
                <>
                  <span className="btn-spinner" aria-hidden />
                  Checking…
                </>
              ) : (
                'Check again'
              )}
            </button>
            {checkNotice && <p className="embedding-model-missing-notice">{checkNotice}</p>}
          </section>

          <footer className="embedding-model-missing-footer">
            <div className="embedding-model-missing-opt-out">
              <input
                id="embedding-model-missing-opt-out"
                type="checkbox"
                checked={dontRemindAgain}
                onChange={(e) => {
                  dontRemindAgainRef.current = e.target.checked;
                  setDontRemindAgain(e.target.checked);
                  setContinueError(null);
                }}
              />
              <label htmlFor="embedding-model-missing-opt-out">Don&apos;t remind me again</label>
            </div>
            {continueError && <p className="embedding-model-missing-notice">{continueError}</p>}
            <div className="modal-actions embedding-model-missing-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={continuing}
                onClick={() => void continueWithoutEmbedding()}
              >
                {continuing ? 'Continuing…' : 'Continue without embedding model'}
              </button>
            </div>
          </footer>
        </div>
      </div>,
      document.body
    );

  return (
    <>
      {missingDialog}
      {successOpen && (
        <EmbeddingModelFoundDialog model={successModel} onClose={() => setSuccessOpen(false)} />
      )}
    </>
  );
}

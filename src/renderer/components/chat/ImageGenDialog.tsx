import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageGenAspect, ImageGenResult, ImageGenSaveTarget } from '../../../shared/types/imageGen';

interface Props {
  conversationId: string;
  characterId: string;
  characterName: string;
  personaId: string;
  personaName: string;
  /** The chat model currently selected -- it writes the draft prompt. */
  model: string;
  onClose: () => void;
}

type Stage = 'drafting' | 'editing' | 'generating' | 'done';

const ASPECT_LABELS: Record<ImageGenAspect, string> = {
  portrait: 'Portrait (832×1216)',
  square: 'Square (1024×1024)',
  landscape: 'Landscape (1216×832)',
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * "Generate image": the chat model drafts a text-to-image prompt from the current scene, the
 * user edits it, KVGenius renders it, and the result can be saved to the character's or the
 * persona's gallery. Nothing is stored until a Save button is pressed.
 */
export default function ImageGenDialog({
  conversationId,
  characterId,
  characterName,
  personaId,
  personaName,
  model,
  onClose,
}: Props) {
  const [stage, setStage] = useState<Stage>('drafting');
  const [prompt, setPrompt] = useState('');
  const [hint, setHint] = useState('');
  const [aspect, setAspect] = useState<ImageGenAspect>('portrait');
  const [result, setResult] = useState<ImageGenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kvgeniusDown, setKvgeniusDown] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<ImageGenSaveTarget>>(new Set());
  const [saving, setSaving] = useState<ImageGenSaveTarget | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const requestId = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Closing mid-render stops the GPU job rather than leaving it to finish unseen.
      if (requestId.current) void window.electronAPI.imageGen.cancel(requestId.current);
    };
  }, []);

  const draftPrompt = useCallback(async () => {
    setStage('drafting');
    setError(null);
    try {
      const status = await window.electronAPI.imageGen.status();
      if (!mounted.current) return;
      setKvgeniusDown(status.available ? null : status.message);
      const { prompt: drafted } = await window.electronAPI.imageGen.composePrompt({
        conversationId,
        characterId,
        personaId: personaId || undefined,
        model,
        hint: hint.trim() || undefined,
      });
      if (!mounted.current) return;
      setPrompt(drafted);
    } catch (e) {
      if (mounted.current) setError(`Couldn't draft a prompt: ${errorText(e)}`);
    } finally {
      if (mounted.current) setStage('editing');
    }
    // `hint` is read when the user presses Redraft, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, characterId, personaId, model]);

  useEffect(() => {
    void draftPrompt();
  }, [draftPrompt]);

  useEffect(() => {
    if (stage !== 'generating') return;
    const startedAt = Date.now();
    setElapsedMs(0);
    const interval = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(interval);
  }, [stage]);

  const generate = async () => {
    if (!prompt.trim() || stage === 'generating') return;
    const id = crypto.randomUUID();
    requestId.current = id;
    setError(null);
    setSaved(new Set());
    setStage('generating');
    try {
      const generated = await window.electronAPI.imageGen.generate({ requestId: id, prompt, aspect });
      if (!mounted.current) return;
      setResult(generated);
      setStage('done');
    } catch (e) {
      if (!mounted.current) return;
      // A cancel the user asked for is not an error worth a banner.
      const message = errorText(e);
      setError(/cancelled/i.test(message) ? null : message);
      setStage('editing');
    } finally {
      requestId.current = null;
    }
  };

  const cancelGeneration = () => {
    if (requestId.current) void window.electronAPI.imageGen.cancel(requestId.current);
  };

  const save = async (target: ImageGenSaveTarget) => {
    if (!result || saving) return;
    setSaving(target);
    setError(null);
    try {
      await window.electronAPI.imageGen.save({
        resultId: result.resultId,
        target,
        targetId: target === 'character' ? characterId : personaId,
      });
      setSaved((current) => new Set(current).add(target));
    } catch (e) {
      setError(`Couldn't save the image: ${errorText(e)}`);
    } finally {
      setSaving(null);
    }
  };

  const busy = stage === 'drafting' || stage === 'generating';

  return (
    <div className="memories-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <div className="memories-dialog imagegen-dialog" role="dialog" aria-label="Generate image" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="chat-sidebar-collapse-btn message-prompt-dialog-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
        <header className="memories-header">
          <h2>🖼 Generate image</h2>
        </header>

        {kvgeniusDown && (
          <p className="imagegen-warning">
            {kvgeniusDown}{' '}
            <button type="button" className="btn" onClick={() => void draftPrompt()}>
              Check again
            </button>
          </p>
        )}
        {error && <p className="imagegen-error">{error}</p>}

        {stage === 'done' && result ? (
          <>
            <img className="imagegen-preview" src={result.dataUrl} alt="Generated scene" />
            <div className="imagegen-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving !== null || saved.has('character')}
                onClick={() => void save('character')}
              >
                {saved.has('character') ? `Saved to ${characterName} ✓` : `Save to ${characterName}`}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!personaId || saving !== null || saved.has('persona')}
                title={personaId ? undefined : 'No persona is selected for this chat'}
                onClick={() => void save('persona')}
              >
                {saved.has('persona') ? `Saved to ${personaName} ✓` : `Save to ${personaName || 'persona'}`}
              </button>
              <button type="button" className="btn" onClick={() => setStage('editing')}>
                Edit prompt
              </button>
              <button type="button" className="btn" onClick={() => void generate()}>
                Try again
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="imagegen-label" htmlFor="imagegen-hint">
              Focus (optional)
            </label>
            <div className="imagegen-hint-row">
              <input
                id="imagegen-hint"
                className="input"
                value={hint}
                disabled={busy}
                maxLength={200}
                placeholder="e.g. the two of them on the dock at dusk"
                onChange={(e) => setHint(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void draftPrompt();
                }}
              />
              <button type="button" className="btn" disabled={busy} onClick={() => void draftPrompt()}>
                {stage === 'drafting' ? 'Drafting…' : 'Redraft'}
              </button>
            </div>

            <label className="imagegen-label" htmlFor="imagegen-prompt">
              Image prompt
            </label>
            <textarea
              id="imagegen-prompt"
              className="input imagegen-prompt"
              rows={6}
              value={stage === 'drafting' ? '' : prompt}
              placeholder={stage === 'drafting' ? `${model} is describing the scene…` : 'Describe the image…'}
              disabled={busy}
              maxLength={2000}
              onChange={(e) => setPrompt(e.target.value)}
            />

            <div className="imagegen-actions">
              <select
                className="input"
                value={aspect}
                disabled={busy}
                aria-label="Image shape"
                onChange={(e) => setAspect(e.target.value as ImageGenAspect)}
              >
                {(Object.keys(ASPECT_LABELS) as ImageGenAspect[]).map((key) => (
                  <option key={key} value={key}>
                    {ASPECT_LABELS[key]}
                  </option>
                ))}
              </select>
              {stage === 'generating' ? (
                <button type="button" className="btn btn-danger" onClick={cancelGeneration}>
                  Cancel ({(elapsedMs / 1000).toFixed(0)}s)
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !prompt.trim() || kvgeniusDown !== null}
                  onClick={() => void generate()}
                >
                  Generate
                </button>
              )}
              {stage === 'generating' && <span className="btn-spinner" aria-hidden />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

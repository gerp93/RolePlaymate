import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserPersona } from '../../shared/types/userPersona';
import { PersonaImage } from '../../shared/types/personaImage';
import PersonaHistoryPanel from '../components/lore/PersonaHistoryPanel';
import PersonaBackgroundEditor from '../components/PersonaBackgroundEditor';
import { toImageUrl } from '../utils/imageUrl';
import { useSecurity } from '../context/SecurityContext';
import LockedPlaceholder from '../components/LockedPlaceholder';
import LimitedInput from '../components/LimitedInput';
import CharacterVoicePicker from '../components/CharacterVoicePicker';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { CharacterTtsVoice } from '../../shared/types/tts';
import { useVoicePreview } from '../hooks/useVoicePreview';

export default function PersonaDetail() {
  const { personaId } = useParams<{ personaId: string }>();
  const navigate = useNavigate();
  const { hiddenUnlocked } = useSecurity();
  const [persona, setPersona] = useState<UserPersona | null>(null);
  const [images, setImages] = useState<PersonaImage[]>([]);
  const [imageIndex, setImageIndex] = useState(0);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voicePreview = useVoicePreview();

  // hiddenUnlocked: a persona already fetched under the previous lock state holds ciphertext
  // when hidden -- re-fetch on every lock/unlock so content updates immediately instead of
  // only after a manual reload.
  useEffect(() => {
    if (personaId) void load(personaId);
  }, [personaId, hiddenUnlocked]);

  async function load(id: string, preferImageId?: string) {
    const [all, imageList] = await Promise.all([
      window.electronAPI.personas.getAll(),
      window.electronAPI.personaImages.getByPersona(id),
    ]);
    const found = all.find((p) => p.id === id) ?? null;
    if (!found) {
      navigate('/personas');
      return;
    }
    setPersona(found);
    setNameDraft(found.name);
    setDescriptionDraft(found.description ?? '');
    setImages(imageList);
    const preferredIndex = preferImageId ? imageList.findIndex((img) => img.id === preferImageId) : -1;
    setImageIndex(preferredIndex >= 0 ? preferredIndex : 0);
  }

  async function handleNameBlur() {
    if (!personaId || !persona) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== persona.name) {
      await window.electronAPI.personas.update(personaId, { name: trimmed });
      await load(personaId);
    }
  }

  async function handleDescriptionBlur() {
    if (!personaId || !persona) return;
    if (descriptionDraft !== (persona.description ?? '')) {
      await window.electronAPI.personas.update(personaId, { description: descriptionDraft });
      await load(personaId);
    }
  }

  async function handleVoiceChange(voice: CharacterTtsVoice | null) {
    if (!personaId || !persona) return;
    const previous = persona;
    setVoiceError(null);
    setPersona({ ...persona, ttsVoice: voice });
    try {
      const updated = await window.electronAPI.personas.update(personaId, { ttsVoice: voice });
      if (voice && !updated.ttsVoice) {
        setPersona(previous);
        setVoiceError('Spoken voice did not save. Fully quit and restart RolePlaymate, then try again.');
        return;
      }
      setPersona(updated);
    } catch (err) {
      setPersona(previous);
      setVoiceError(err instanceof Error ? err.message : 'Could not save spoken voice.');
    }
  }

  async function handleAddImage() {
    if (!personaId) return;
    setImageBusy(true);
    try {
      const added = await window.electronAPI.personaImages.add(personaId);
      if (added.length > 0) {
        await load(personaId, added[0].id);
      }
    } finally {
      setImageBusy(false);
    }
  }

  async function handleRemoveCurrentImage() {
    if (!personaId) return;
    const current = images[imageIndex];
    if (!current) return;
    if (!confirm('Remove this image? This cannot be undone.')) return;
    await window.electronAPI.personaImages.remove(current.id);
    await load(personaId);
  }

  async function handleSetCover() {
    if (!personaId) return;
    const current = images[imageIndex];
    if (!current) return;
    await window.electronAPI.personaImages.setCover(current.id);
    await load(personaId, current.id);
  }

  function showPrevImage() {
    if (images.length < 2) return;
    setImageIndex((i) => (i - 1 + images.length) % images.length);
  }

  function showNextImage() {
    if (images.length < 2) return;
    setImageIndex((i) => (i + 1) % images.length);
  }

  if (!persona) return <div className="text-muted">Loading…</div>;
  if (persona.isHidden && !hiddenUnlocked) return <LockedPlaceholder label="This persona" />;

  const currentImage = images[imageIndex];

  return (
    <div className="character-detail-page">
      <div className="character-detail-fields">
        <div className="page-header">
          <LimitedInput
            value={nameDraft}
            limit={FIELD_LIMITS.name}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleNameBlur}
            style={{
              fontSize: 22,
              fontWeight: 700,
              border: 'none',
              background: 'transparent',
              padding: '4px 0',
            }}
          />
          <LimitedInput
            value={descriptionDraft}
            limit={FIELD_LIMITS.short}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder="A short note for your own reference..."
            className="text-muted"
            style={{
              fontSize: 14,
              border: 'none',
              background: 'transparent',
              padding: '2px 0 4px',
            }}
          />
        </div>

        <CharacterVoicePicker
          value={persona.ttsVoice}
          onChange={(voice) => void handleVoiceChange(voice)}
          preview={voicePreview}
          label="Spoken voice"
          noneLabel="None — use Settings narrator voice if one is set"
        />
        {voiceError && (
          <p className="field-error" style={{ marginTop: -8 }}>
            {voiceError}
          </p>
        )}

        {/* Keyed on hiddenUnlocked too -- PersonaBackgroundEditor fetches its own version
            history once per mount, so it needs to remount (and re-fetch) on lock/unlock the
            same as this page's own load() above, or its already-fetched content would stay
            stale ciphertext. */}
        <PersonaBackgroundEditor key={`${persona.id}-${hiddenUnlocked}`} personaId={persona.id} />

        <PersonaHistoryPanel personaId={persona.id} />
      </div>

      <div className="character-detail-portrait-panel">
        <div className="character-detail-portrait-large">
          {currentImage ? <img src={toImageUrl(currentImage.path)} alt={persona.name} /> : <span>?</span>}

          {images.length > 1 && (
            <>
              <button
                type="button"
                className="portrait-nav-btn portrait-nav-prev"
                onClick={showPrevImage}
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                type="button"
                className="portrait-nav-btn portrait-nav-next"
                onClick={showNextImage}
                aria-label="Next image"
              >
                ›
              </button>
            </>
          )}
        </div>

        {images.length > 1 && (
          <div className="portrait-dots">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                className={`portrait-dot${i === imageIndex ? ' active' : ''}`}
                onClick={() => setImageIndex(i)}
                aria-label={`Show image ${i + 1} of ${images.length}`}
              />
            ))}
          </div>
        )}

        {images.length > 1 && imageIndex !== 0 && (
          <button className="btn" onClick={() => void handleSetCover()} title="Show this image on the persona card">
            Set as Cover
          </button>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={imageBusy} onClick={() => void handleAddImage()} style={{ flex: 1 }}>
            {imageBusy ? 'Adding…' : 'Add Image…'}
          </button>
          {currentImage && (
            <button className="btn btn-danger" onClick={() => void handleRemoveCurrentImage()}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

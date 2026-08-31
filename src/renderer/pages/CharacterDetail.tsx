import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { CharacterField, FIELD_TYPES } from '../../shared/types/characterField';
import { CharacterImage } from '../../shared/types/characterImage';
import FieldEditor from '../components/FieldEditor';
import ScenariosPanel from '../components/ScenariosPanel';
import PersonalHistoryPanel from '../components/lore/PersonalHistoryPanel';
import { toImageUrl } from '../utils/imageUrl';
import { useSecurity } from '../context/SecurityContext';
import LockedPlaceholder from '../components/LockedPlaceholder';
import LimitedInput from '../components/LimitedInput';
import CharacterVoicePicker from '../components/CharacterVoicePicker';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { CharacterTtsVoice } from '../../shared/types/tts';
import { useVoicePreview } from '../hooks/useVoicePreview';

const FIELD_PLACEHOLDERS: Record<string, string> = {
  personality: 'Traits, speech patterns, quirks, values...',
  dialogue: 'Sample exchanges showing how the character speaks...',
};

export default function CharacterDetail() {
  const { characterId } = useParams<{ characterId: string }>();
  const navigate = useNavigate();
  const { hiddenUnlocked } = useSecurity();
  const [character, setCharacter] = useState<Character | null>(null);
  const [fields, setFields] = useState<CharacterField[]>([]);
  const [images, setImages] = useState<CharacterImage[]>([]);
  const [imageIndex, setImageIndex] = useState(0);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voicePreview = useVoicePreview();

  // hiddenUnlocked: a character/its fields already fetched under the previous lock state hold
  // ciphertext when hidden -- re-fetch on every lock/unlock so content updates immediately
  // instead of only after a manual reload.
  useEffect(() => {
    if (characterId) load(characterId);
  }, [characterId, hiddenUnlocked]);

  async function load(id: string, preferImageId?: string) {
    const [c, fieldList, imageList] = await Promise.all([
      window.electronAPI.characters.getById(id),
      window.electronAPI.fields.getByCharacter(id),
      window.electronAPI.characterImages.getByCharacter(id),
    ]);
    if (!c) {
      navigate('/characters');
      return;
    }
    setCharacter(c);
    setNameDraft(c.name);
    setDescriptionDraft(c.description ?? '');
    setFields(fieldList);
    setImages(imageList);
    const preferredIndex = preferImageId ? imageList.findIndex((img) => img.id === preferImageId) : -1;
    setImageIndex(preferredIndex >= 0 ? preferredIndex : 0);
  }

  async function handleNameBlur() {
    if (!characterId || !character) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== character.name) {
      await window.electronAPI.characters.update(characterId, { name: trimmed });
      await load(characterId);
    }
  }

  async function handleDescriptionBlur() {
    if (!characterId || !character) return;
    if (descriptionDraft !== (character.description ?? '')) {
      await window.electronAPI.characters.update(characterId, { description: descriptionDraft });
      await load(characterId);
    }
  }

  async function handleVoiceChange(voice: CharacterTtsVoice | null) {
    if (!characterId || !character) return;
    const previous = character;
    setVoiceError(null);
    setCharacter({ ...character, ttsVoice: voice });
    try {
      const updated = await window.electronAPI.characters.update(characterId, { ttsVoice: voice });
      if (voice && !updated.ttsVoice) {
        setCharacter(previous);
        setVoiceError('Spoken voice did not save. Fully quit and restart RolePlaymate, then try again.');
        return;
      }
      setCharacter(updated);
    } catch (err) {
      setCharacter(previous);
      setVoiceError(err instanceof Error ? err.message : 'Could not save spoken voice.');
    }
  }

  async function handleAddImage() {
    if (!characterId) return;
    setImageBusy(true);
    try {
      // The picker allows selecting several files at once; land on the first newly added one
      // rather than staying put, so it's clear something happened.
      const added = await window.electronAPI.characterImages.add(characterId);
      if (added.length > 0) {
        await load(characterId, added[0].id);
      }
    } finally {
      setImageBusy(false);
    }
  }

  async function handleRemoveCurrentImage() {
    if (!characterId) return;
    const current = images[imageIndex];
    if (!current) return;
    if (!confirm('Remove this image? This cannot be undone.')) return;
    await window.electronAPI.characterImages.remove(current.id);
    await load(characterId);
  }

  async function handleSetCover() {
    if (!characterId) return;
    const current = images[imageIndex];
    if (!current) return;
    await window.electronAPI.characterImages.setCover(current.id);
    // Reordering moves this image to the front of the list -- follow it, so the viewer stays
    // on the same picture rather than landing wherever index 0 used to point.
    await load(characterId, current.id);
  }

  function showPrevImage() {
    if (images.length < 2) return;
    setImageIndex((i) => (i - 1 + images.length) % images.length);
  }

  function showNextImage() {
    if (images.length < 2) return;
    setImageIndex((i) => (i + 1) % images.length);
  }

  if (!character) return <div className="text-muted">Loading…</div>;
  if (character.isHidden && !hiddenUnlocked) return <LockedPlaceholder label="This character" />;

  const fieldsByType = new Map(fields.map((f) => [f.fieldType, f]));
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
            placeholder="Short description or tagline..."
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
          value={character.ttsVoice}
          onChange={(voice) => void handleVoiceChange(voice)}
          preview={voicePreview}
        />
        {voiceError && (
          <p className="field-error" style={{ marginTop: -8 }}>
            {voiceError}
          </p>
        )}

        {FIELD_TYPES.map((fieldType) => {
          const field = fieldsByType.get(fieldType);
          if (!field) return null;
          // Keyed on hiddenUnlocked too -- FieldEditor fetches its own version history once per
          // mount, so it needs to remount (and re-fetch) on lock/unlock the same as this page's
          // own load() above, or its already-fetched content would stay stale ciphertext.
          return (
            <FieldEditor
              key={`${field.id}-${hiddenUnlocked}`}
              field={field}
              placeholder={FIELD_PLACEHOLDERS[fieldType]}
            />
          );
        })}

        <div style={{ marginTop: 16 }}>
          <ScenariosPanel characterId={character.id} />
        </div>

        {/* Private history belongs on the character, not beside the shared world books --
            it is this character's own past and must never look attachable elsewhere. */}
        <PersonalHistoryPanel characterId={character.id} />
      </div>

      <div className="character-detail-portrait-panel">
        <div className="character-detail-portrait-large">
          {currentImage ? <img src={toImageUrl(currentImage.path)} alt={character.name} /> : <span>?</span>}

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
          <button className="btn" onClick={() => void handleSetCover()} title="Show this image on the character card">
            Set as Cover
          </button>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={imageBusy} onClick={handleAddImage} style={{ flex: 1 }}>
            {imageBusy ? 'Adding…' : 'Add Image…'}
          </button>
          {currentImage && (
            <button className="btn btn-danger" onClick={handleRemoveCurrentImage}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

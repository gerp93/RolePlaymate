import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { CharacterField, FIELD_TYPES } from '../../shared/types/characterField';
import { CharacterImage } from '../../shared/types/characterImage';
import FieldEditor from '../components/FieldEditor';
import PersonalHistoryPanel from '../components/lore/PersonalHistoryPanel';
import { toImageUrl } from '../utils/imageUrl';

const FIELD_PLACEHOLDERS: Record<string, string> = {
  personality: 'Traits, speech patterns, quirks, values...',
  scenario: 'The setting or context the conversation takes place in...',
  greeting: 'The first message the character sends to start the chat...',
  dialogue: 'Sample exchanges showing how the character speaks...',
};

export default function CharacterDetail() {
  const { characterId } = useParams<{ characterId: string }>();
  const navigate = useNavigate();
  const [character, setCharacter] = useState<Character | null>(null);
  const [fields, setFields] = useState<CharacterField[]>([]);
  const [images, setImages] = useState<CharacterImage[]>([]);
  const [imageIndex, setImageIndex] = useState(0);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [imageBusy, setImageBusy] = useState(false);

  useEffect(() => {
    if (characterId) load(characterId);
  }, [characterId]);

  async function load(id: string, preferImageId?: string) {
    const [c, fieldList, imageList] = await Promise.all([
      window.electronAPI.characters.getById(id),
      window.electronAPI.fields.getByCharacter(id),
      window.electronAPI.characterImages.getByCharacter(id),
    ]);
    if (!c) {
      navigate('/');
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

  const fieldsByType = new Map(fields.map((f) => [f.fieldType, f]));
  const currentImage = images[imageIndex];

  return (
    <div className="character-detail-page">
      <div className="character-detail-fields">
        <div className="page-header">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleNameBlur}
            style={{
              fontSize: 22,
              fontWeight: 700,
              border: 'none',
              background: 'transparent',
              padding: '4px 0',
              width: '100%',
            }}
          />
          <input
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder="Short description or tagline..."
            className="text-muted"
            style={{
              fontSize: 14,
              border: 'none',
              background: 'transparent',
              padding: '2px 0 4px',
              width: '100%',
            }}
          />
        </div>

        {FIELD_TYPES.map((fieldType) => {
          const field = fieldsByType.get(fieldType);
          if (!field) return null;
          return <FieldEditor key={field.id} field={field} placeholder={FIELD_PLACEHOLDERS[fieldType]} />;
        })}

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

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { CharacterField, FIELD_TYPES } from '../../shared/types/characterField';
import FieldEditor from '../components/FieldEditor';

const FIELD_PLACEHOLDERS: Record<string, string> = {
  personality: 'Traits, speech patterns, quirks, values...',
  scenario: 'The setting or context the conversation takes place in...',
  greeting: 'The first message the character sends to start the chat...',
};

export default function CharacterDetail() {
  const { characterId } = useParams<{ characterId: string }>();
  const navigate = useNavigate();
  const [character, setCharacter] = useState<Character | null>(null);
  const [fields, setFields] = useState<CharacterField[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [imageBusy, setImageBusy] = useState(false);

  useEffect(() => {
    if (characterId) load(characterId);
  }, [characterId]);

  async function load(id: string) {
    const [c, fieldList] = await Promise.all([
      window.electronAPI.characters.getById(id),
      window.electronAPI.fields.getByCharacter(id),
    ]);
    if (!c) {
      navigate('/');
      return;
    }
    setCharacter(c);
    setNameDraft(c.name);
    setFields(fieldList);
  }

  async function handleNameBlur() {
    if (!characterId || !character) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== character.name) {
      await window.electronAPI.characters.update(characterId, { name: trimmed });
      await load(characterId);
    }
  }

  async function handleChooseImage() {
    if (!characterId) return;
    setImageBusy(true);
    try {
      const path = await window.electronAPI.images.choose();
      if (path) {
        await window.electronAPI.characters.update(characterId, { imageUrl: path });
        await load(characterId);
      }
    } finally {
      setImageBusy(false);
    }
  }

  async function handleRemoveImage() {
    if (!characterId) return;
    await window.electronAPI.characters.update(characterId, { imageUrl: null });
    await load(characterId);
  }

  if (!character) return <div className="text-muted">Loading…</div>;

  const fieldsByType = new Map(fields.map((f) => [f.fieldType, f]));

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
        </div>

        {FIELD_TYPES.map((fieldType) => {
          const field = fieldsByType.get(fieldType);
          if (!field) return null;
          return <FieldEditor key={field.id} field={field} placeholder={FIELD_PLACEHOLDERS[fieldType]} />;
        })}
      </div>

      <div className="character-detail-portrait-panel">
        <div className="character-detail-portrait-large">
          {character.imageUrl ? <img src={`file://${character.imageUrl}`} alt={character.name} /> : <span>?</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={imageBusy} onClick={handleChooseImage} style={{ flex: 1 }}>
            {imageBusy ? 'Choosing…' : character.imageUrl ? 'Change Portrait…' : 'Choose Portrait…'}
          </button>
          {character.imageUrl && (
            <button className="btn btn-danger" onClick={handleRemoveImage}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { CharacterImage } from '../../shared/types/characterImage';
import { toImageUrl } from '../utils/imageUrl';
import { useSecurity } from '../context/SecurityContext';
import LimitedInput from '../components/LimitedInput';
import { FIELD_LIMITS } from '../../shared/fieldLimits';

// Fewer characters get bigger tiles; past a point tiles bottom out and the grid scrolls
// instead of shrinking further.
function tileMinWidthFor(count: number): number {
  if (count <= 4) return 300;
  if (count <= 8) return 240;
  if (count <= 16) return 200;
  if (count <= 30) return 170;
  return 140;
}

export default function CharacterList() {
  const { hiddenUnlocked } = useSecurity();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [coverImages, setCoverImages] = useState<Record<string, CharacterImage[]>>({});
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  // hiddenUnlocked: characters already fetched under the previous lock state hold ciphertext
  // for anything hidden -- re-fetch on every lock/unlock so names update immediately instead
  // of only after a manual reload.
  useEffect(() => {
    load();
  }, [hiddenUnlocked]);

  async function load() {
    setLoading(true);
    const [characterList, images] = await Promise.all([
      window.electronAPI.characters.getAll(),
      window.electronAPI.characterImages.getAllGroupedByCharacter(),
    ]);
    setCharacters(characterList);
    setCoverImages(images);
    setLoading(false);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    setNameError(false);
    await window.electronAPI.characters.create({ name });
    setNewName('');
    await load();
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this character and all its field history? This cannot be undone.')) return;
    await window.electronAPI.characters.delete(id);
    await load();
  }

  async function handleClone(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await window.electronAPI.characters.clone(id);
    await load();
  }

  async function handleToggleHidden(e: React.MouseEvent, id: string, hidden: boolean) {
    e.preventDefault();
    e.stopPropagation();
    await window.electronAPI.characters.setHidden(id, !hidden);
    await load();
  }

  async function handleImport() {
    setImporting(true);
    try {
      const result = await window.electronAPI.characters.importFromHtml();
      if (!result) return;
      await load();
      if (result.warnings.length > 0) {
        alert(`Imported "${result.character.name}" with some gaps:\n\n${result.warnings.join('\n')}`);
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div className="page-header page-header-hero">
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="RolePlaymate"
          className="hero-logo"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
        <h1>Characters</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <LimitedInput
            value={newName}
            limit={FIELD_LIMITS.name}
            compactCount
            fieldClassName="limited-field-grow"
            onChange={(e) => {
              setNewName(e.target.value);
              if (nameError) setNameError(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New character name"
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            Create Character
          </button>
          <button className="btn" disabled={importing} onClick={handleImport}>
            {importing ? 'Importing…' : 'Import from HTML…'}
          </button>
        </div>
        {nameError && <p className="field-error">Enter a name before creating a character.</p>}
      </div>

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : characters.length === 0 ? (
        <div className="text-muted">No characters yet -- create one above.</div>
      ) : (
        <div
          className="character-grid"
          style={{ '--tile-min-width': `${tileMinWidthFor(characters.length)}px` } as React.CSSProperties}
        >
          {characters
            .filter((character) => hiddenUnlocked || !character.isHidden)
            .map((character) => {
              const cover = coverImages[character.id]?.[0];
              return (
                <Link key={character.id} to={`/characters/${character.id}`} className="card character-card">
                  <div className="character-card-portrait">
                    {cover ? <img src={toImageUrl(cover.path)} alt={character.name} /> : <span>?</span>}
                  </div>
                  <div className="character-card-body">
                    <p className="character-card-name">{character.name}</p>
                    {character.isHidden && <p className="text-muted persona-warning">🔒 Hidden</p>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      {hiddenUnlocked && (
                        <button
                          className="btn"
                          onClick={(e) => void handleToggleHidden(e, character.id, character.isHidden)}
                        >
                          {character.isHidden ? 'Unhide' : 'Hide'}
                        </button>
                      )}
                      <button className="btn" onClick={(e) => handleClone(e, character.id)}>
                        Clone
                      </button>
                      <button className="btn btn-danger" onClick={(e) => handleDelete(e, character.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}

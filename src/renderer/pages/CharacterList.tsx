import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { CharacterImage } from '../../shared/types/characterImage';

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
  const [characters, setCharacters] = useState<Character[]>([]);
  const [coverImages, setCoverImages] = useState<Record<string, CharacterImage[]>>({});
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    load();
  }, []);

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
    if (!name) return;
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
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New character name"
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            Create Character
          </button>
          <button className="btn" disabled={importing} onClick={handleImport}>
            {importing ? 'Importing…' : 'Import from HTML…'}
          </button>
        </div>
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
          {characters.map((character) => {
            const cover = coverImages[character.id]?.[0];
            return (
              <Link key={character.id} to={`/characters/${character.id}`} className="card character-card">
                <div className="character-card-portrait">
                  {cover ? <img src={`file://${cover.path}`} alt={character.name} /> : <span>?</span>}
                </div>
                <div className="character-card-body">
                  <p className="character-card-name">{character.name}</p>
                  <div style={{ display: 'flex', gap: 8 }}>
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

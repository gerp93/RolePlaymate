import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Character } from '../../shared/types/character';

export default function CharacterList() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setCharacters(await window.electronAPI.characters.getAll());
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
        </div>
      </div>

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : characters.length === 0 ? (
        <div className="text-muted">No characters yet -- create one above.</div>
      ) : (
        <div className="character-grid">
          {characters.map((character) => (
            <Link key={character.id} to={`/characters/${character.id}`} className="card character-card">
              <div className="character-card-portrait">
                {character.imageUrl ? (
                  <img src={`file://${character.imageUrl}`} alt={character.name} />
                ) : (
                  <span>?</span>
                )}
              </div>
              <div className="character-card-body">
                <p className="character-card-name">{character.name}</p>
                <button className="btn btn-danger" onClick={(e) => handleDelete(e, character.id)}>
                  Delete
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

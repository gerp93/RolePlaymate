import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { CharacterImage } from '../../shared/types/characterImage';
import { toImageUrl } from '../utils/imageUrl';
import { useSecurity } from '../context/SecurityContext';
import LimitedInput from '../components/LimitedInput';
import CroppableImage from '../components/CroppableImage';
import LibraryFilterBar from '../components/LibraryFilterBar';
import { useImageCrops } from '../hooks/useImageCrops';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { filterAndSortLibrary, LibrarySort } from '../utils/librarySort';
import { formatCount, formatTokenRange } from '../utils/usageStats';

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
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySort>('name-asc');
  const [showIssues, setShowIssues] = useState(false);
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  const [tokenEstimates, setTokenEstimates] = useState<Record<string, { low: number; high: number }>>({});
  const coverImageIds = Object.values(coverImages)
    .map((images) => images[0]?.id)
    .filter((id): id is string => !!id);
  const { crops, refresh: refreshCrops } = useImageCrops(coverImageIds);

  // hiddenUnlocked: characters already fetched under the previous lock state hold ciphertext
  // for anything hidden -- re-fetch on every lock/unlock so names update immediately instead
  // of only after a manual reload.
  useEffect(() => {
    reload();
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
    // Not awaited -- the estimates fill in after the grid is already showing.
    void window.electronAPI.characters.getAllTokenEstimates().then(setTokenEstimates);
  }

  // Issues are only fetched while the toggle is on, so a mutation elsewhere (create/delete/
  // clone/hide) doesn't pay for a computation nobody's looking at.
  async function reload() {
    await load();
    if (showIssues) {
      setIssues(await window.electronAPI.characters.getIssues());
    }
  }

  async function handleToggleIssues() {
    const next = !showIssues;
    setShowIssues(next);
    if (next) {
      setIssues(await window.electronAPI.characters.getIssues());
    }
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
    await reload();
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this character and all its field history? This cannot be undone.')) return;
    await window.electronAPI.characters.delete(id);
    await reload();
  }

  async function handleClone(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await window.electronAPI.characters.clone(id);
    await reload();
  }

  async function handleToggleHidden(e: React.MouseEvent, id: string, hidden: boolean) {
    e.preventDefault();
    e.stopPropagation();
    await window.electronAPI.characters.setHidden(id, !hidden);
    await reload();
  }

  async function handleImport() {
    setImporting(true);
    try {
      const result = await window.electronAPI.characters.importFromHtml();
      if (!result) return;
      await reload();
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
        <>
          <LibraryFilterBar
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            placeholder="Search characters…"
            after={
              <button
                type="button"
                className={`btn${showIssues ? ' btn-primary' : ''}`}
                onClick={() => void handleToggleIssues()}
              >
                {showIssues ? 'Hide Issues' : 'Show Issues'}
              </button>
            }
          />
          {(() => {
            const visible = filterAndSortLibrary(
              characters.filter((character) => hiddenUnlocked || !character.isHidden),
              search,
              sort,
              (character) => character.name
            );
            if (visible.length === 0) {
              return <div className="text-muted">No characters match "{search}".</div>;
            }
            return (
              <div
                className="character-grid"
                style={{ '--tile-min-width': `${tileMinWidthFor(visible.length)}px` } as React.CSSProperties}
              >
                {visible.map((character) => {
                  const cover = coverImages[character.id]?.[0];
                  const characterIssues = issues[character.id];
                  return (
                    <Link key={character.id} to={`/characters/${character.id}`} className="card character-card">
                      <div className="character-card-portrait">
                        {cover ? (
                          <CroppableImage
                            src={toImageUrl(cover.path)}
                            alt={character.name}
                            imageId={cover.id}
                            imageOwner="character"
                            location="card"
                            crop={crops[cover.id]?.card}
                            onCropSaved={refreshCrops}
                          />
                        ) : (
                          <span>?</span>
                        )}
                      </div>
                      <div className="character-card-body">
                        <p className="character-card-name">{character.name}</p>
                        {character.isHidden && <p className="text-muted persona-warning">🔒 Hidden</p>}
                        <div className="character-card-stats">
                          <span>{formatCount(character.messageCount, 'message')}</span>
                          {tokenEstimates[character.id] && (
                            <span title="Estimated base-prompt tokens, across this character's scenarios">
                              {formatTokenRange(tokenEstimates[character.id].low, tokenEstimates[character.id].high)} tokens
                            </span>
                          )}
                        </div>
                        {showIssues && characterIssues && characterIssues.length > 0 && (
                          <div className="character-card-issues">
                            {characterIssues.map((issue) => (
                              <span key={issue} className="character-card-issue">
                                {issue}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="character-card-actions">
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
            );
          })()}
        </>
      )}
    </div>
  );
}

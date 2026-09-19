import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPersona } from '../../shared/types/userPersona';
import { PersonaImage } from '../../shared/types/personaImage';
import { toImageUrl } from '../utils/imageUrl';
import { useSecurity } from '../context/SecurityContext';
import LimitedInput from '../components/LimitedInput';
import CroppableImage from '../components/CroppableImage';
import LibraryFilterBar from '../components/LibraryFilterBar';
import { useImageCrops } from '../hooks/useImageCrops';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { filterAndSortLibrary, LibrarySort } from '../utils/librarySort';
import { formatCount, formatTokenRange } from '../utils/usageStats';

// Same sizing rule as the character grid -- fewer tiles get bigger, more tiles bottom out and
// scroll instead of shrinking further. Kept identical on purpose: the two grids should read as
// the same kind of page.
function tileMinWidthFor(count: number): number {
  if (count <= 4) return 300;
  if (count <= 8) return 240;
  if (count <= 16) return 200;
  if (count <= 30) return 170;
  return 140;
}

/**
 * Personas are who *you* play, as opposed to Characters, who the AI plays. Presented as the
 * same card-grid-plus-detail-page shape as Characters and World books, rather than the single
 * inline list-and-editor the source used -- three different UI patterns for three libraries
 * that are all "a bunch of cards you open one of" was the inconsistency, not the grid itself.
 */
export default function PersonaList() {
  const { hiddenUnlocked } = useSecurity();
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [coverImages, setCoverImages] = useState<Record<string, PersonaImage[]>>({});
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySort>('name-asc');
  const [tokenEstimates, setTokenEstimates] = useState<Record<string, number>>({});
  const coverImageIds = Object.values(coverImages)
    .map((images) => images[0]?.id)
    .filter((id): id is string => !!id);
  const { crops, refresh: refreshCrops } = useImageCrops(coverImageIds);

  // hiddenUnlocked: personas already fetched under the previous lock state hold ciphertext
  // for anything hidden -- re-fetch on every lock/unlock so names update immediately instead
  // of only after a manual reload.
  useEffect(() => {
    void load();
  }, [hiddenUnlocked]);

  async function load() {
    setLoading(true);
    const [personaList, images] = await Promise.all([
      window.electronAPI.personas.getAll(),
      window.electronAPI.personaImages.getAllGroupedByPersona(),
    ]);
    setPersonas(personaList);
    setCoverImages(images);
    setLoading(false);
    void window.electronAPI.personas.getAllTokenEstimates().then(setTokenEstimates);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    setNameError(false);
    await window.electronAPI.personas.create({ name });
    setNewName('');
    await load();
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this persona? This cannot be undone.')) return;
    await window.electronAPI.personas.delete(id);
    await load();
  }

  async function handleClone(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await window.electronAPI.personas.clone(id);
    await load();
  }

  async function handleToggleHidden(e: React.MouseEvent, id: string, hidden: boolean) {
    e.preventDefault();
    e.stopPropagation();
    await window.electronAPI.personas.setHidden(id, !hidden);
    await load();
  }

  return (
    <div>
      <div className="page-header">
        <h1>Personas</h1>
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
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            placeholder="New persona name"
          />
          <button className="btn btn-primary" onClick={() => void handleCreate()}>
            Create Persona
          </button>
        </div>
        {nameError && <p className="field-error">Enter a name before creating a persona.</p>}
      </div>

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : personas.length === 0 ? (
        <div className="text-muted">No personas yet -- create one above.</div>
      ) : (
        <>
          <LibraryFilterBar
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            placeholder="Search personas…"
          />
          {(() => {
            const visible = filterAndSortLibrary(
              personas.filter((persona) => hiddenUnlocked || !persona.isHidden),
              search,
              sort,
              (persona) => persona.name
            );
            if (visible.length === 0) {
              return <div className="text-muted">No personas match "{search}".</div>;
            }
            return (
              <div
                className="character-grid"
                style={{ '--tile-min-width': `${tileMinWidthFor(visible.length)}px` } as React.CSSProperties}
              >
                {visible.map((persona) => {
                  const cover = coverImages[persona.id]?.[0];
                  return (
                    <Link key={persona.id} to={`/personas/${persona.id}`} className="card character-card">
                      <div className="character-card-portrait">
                        {cover ? (
                          <CroppableImage
                            src={toImageUrl(cover.path)}
                            alt={persona.name}
                            imageId={cover.id}
                            imageOwner="persona"
                            location="card"
                            crop={crops[cover.id]?.card}
                            onCropSaved={refreshCrops}
                          />
                        ) : (
                          <span>?</span>
                        )}
                      </div>
                      <div className="character-card-body">
                        <p className="character-card-name">{persona.name}</p>
                        {persona.isHidden && <p className="text-muted persona-warning">🔒 Hidden</p>}
                        <div className="character-card-stats">
                          <span>{formatCount(persona.messageCount, 'message')}</span>
                          {tokenEstimates[persona.id] > 0 && (
                            <span title="Estimated tokens when this persona is included in a prompt">
                              {formatTokenRange(tokenEstimates[persona.id], tokenEstimates[persona.id])} tokens
                            </span>
                          )}
                        </div>
                        {!persona.background?.trim() && (
                          <p className="text-muted persona-warning">No background yet</p>
                        )}
                        <div className="character-card-actions">
                          {hiddenUnlocked && (
                            <button
                              className="btn"
                              onClick={(e) => void handleToggleHidden(e, persona.id, persona.isHidden)}
                            >
                              {persona.isHidden ? 'Unhide' : 'Hide'}
                            </button>
                          )}
                          <button className="btn" onClick={(e) => void handleClone(e, persona.id)}>
                            Clone
                          </button>
                          <button className="btn btn-danger" onClick={(e) => void handleDelete(e, persona.id)}>
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
